import { randomUUID } from 'node:crypto';
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { FilmSchema, CohortSchema, ScreeningSlotSchema, ConstraintsSchema } from '@rr/domain';
import { solveProgramme, validateProgramme } from '@rr/solver';
import { collectAffinities, EvidenceCollectionError, recordEvidence } from './evidence.js';
import type { AppState, EvidenceMode, EvidenceSnapshot, ProgrammeVersion, WorkflowRun, ToolStep } from './types.js';

type SolverResult = ReturnType<typeof solveProgramme>;
interface GenerationContext {
  state: AppState; run: WorkflowRun; mode: EvidenceMode; parent?: ProgrammeVersion;
  evidence?: EvidenceSnapshot; solution?: SolverResult; version?: ProgrammeVersion;
  repairPolicy?: 'MINIMAL_CHANGE' | 'GLOBAL_FAIRNESS';
}
const GraphState = Annotation.Root({ ctx: Annotation<GenerationContext>({reducer: (_old, current) => current}) });
const stamp = () => new Date().toISOString();
function node(name: string, action: (ctx: GenerationContext) => Promise<string> | string) {
  return async ({ctx}: typeof GraphState.State) => {
    const step: ToolStep = {node:name,startedAt:stamp(),endedAt:stamp(),status:'OK',detail:''};
    ctx.run.steps.push(step);
    try { step.detail = await action(ctx); }
    catch (error) { step.status='ERROR'; step.detail = error instanceof Error ? error.message : 'Unknown workflow failure'; throw error; }
    finally { step.endedAt=stamp(); }
    return {ctx};
  };
}
function solverInput(ctx: GenerationContext) {
  const {state} = ctx;
  return {
    films:ctx.mode === 'QLOO' ? state.films.filter(f=>ctx.evidence!.candidateFilmIds.includes(f.id)) : state.films,cohorts:state.cohorts,slots:state.slots,constraints:state.constraints,
    affinities:ctx.evidence!.affinities,
    ...(ctx.parent && ctx.run.trigger === 'REPAIR' ? {repair:{previousItems:ctx.parent.items,policy:ctx.repairPolicy ?? 'MINIMAL_CHANGE' as const}} : {}),
  };
}
const workflow = new StateGraph(GraphState)
  .addNode('load_catalogue',node('load_catalogue',ctx => `Loaded ${ctx.state.films.length} session-scoped films, ${ctx.state.cohorts.length} cohorts and ${ctx.state.slots.length} slots at revision ${ctx.state.revision}.`))
  .addNode('validate_inputs',node('validate_inputs',ctx => {
    const s=ctx.state;
    s.films.forEach(f=>FilmSchema.parse(f));s.cohorts.forEach(c=>CohortSchema.parse(c));s.slots.forEach(slot=>ScreeningSlotSchema.parse(slot));ConstraintsSchema.parse(s.constraints);
    if (!s.films.length || !s.cohorts.length || !s.slots.length) throw new Error('INVALID_INPUT: Films, cohorts and slots are required.');
    if (s.films.length>30 || s.cohorts.length>3 || s.slots.length>4) throw new Error('BOUNDED_WORKFLOW: Maximum 30 films, 3 cohorts and 4 slots.');
    return 'Input schemas validated. Unknown rights are ineligible. No model can override constraints.';
  }))
  .addNode('collect_evidence',node('collect_evidence',async ctx => {
    let evidence;
    try { evidence=await collectAffinities(ctx.state,ctx.mode); }
    catch(error) {
      if(error instanceof EvidenceCollectionError) {
        ctx.evidence=recordEvidence(ctx.state,ctx.mode,error.evidence,error.evidence.providerResponses.length?'PARTIAL':'FAILED',error.message);
        ctx.run.evidenceId=ctx.evidence.id;
      }
      throw error;
    }
    ctx.evidence=recordEvidence(ctx.state,ctx.mode,evidence);ctx.run.evidenceId=ctx.evidence.id;
    ctx.state.affinities=evidence.affinities;ctx.state.evidenceMode=ctx.mode;
    if(ctx.mode==='QLOO') ctx.state.providerStatus.qlooStatus='VERIFIED_COMPLETE_RESPONSE';
    return `${evidence.sourceLabel}; fixed universe ${ctx.evidence.candidateFilmIds.length}; ${evidence.warnings.length} warnings.`;
  }))
  .addNode('solve_constraints',node('solve_constraints',ctx => {
    ctx.solution=solveProgramme(solverInput(ctx));
    if(ctx.solution.status!=='OPTIMAL') throw new Error(`${ctx.solution.status}: ${ctx.solution.reason}`);
    return `Deterministic lexicographic solve: minimum cohort coverage ${ctx.solution.objective.minCoverage.toFixed(4)}; ${ctx.solution.items.length} feasible slots.`;
  }))
  .addNode('verify_solution',node('verify_solution',ctx => {
    if(ctx.solution?.status!=='OPTIMAL') throw new Error('No candidate solution');
    const violations=validateProgramme(solverInput(ctx),ctx.solution.items);
    if(violations.length) throw new Error(`VERIFICATION_FAILED: ${violations.join('; ')}`);
    return 'Independent deterministic validation passed: rights, territory, dates, format, runtime, distinct films and budget.';
  }))
  .addNode('save_draft',node('save_draft',ctx => {
    if(ctx.solution?.status!=='OPTIMAL') throw new Error('No verified solution');
    const solution=ctx.solution;
    const items=solution.items.map(item=>{
      const film=ctx.state.films.find(f=>f.id===item.filmId)!;const slot=ctx.state.slots.find(s=>s.id===item.slotId)!;
      return {...item,filmTitle:film.title,startAt:slot.startAt,endAt:slot.endAt,runtimeMinutes:film.runtimeMinutes,format:slot.format,rightsSnapshot:structuredClone(film.rights)};
    });
    ctx.version={id:randomUUID(),programmeId:ctx.parent?.programmeId ?? ctx.state.versions.at(-1)?.programmeId ?? randomUUID(),
      version:ctx.state.versions.filter(v=>v.programmeId===(ctx.parent?.programmeId ?? ctx.state.versions.at(-1)?.programmeId)).length+1,
      ...(ctx.parent ? {parentVersionId:ctx.parent.id}:{}),createdAt:stamp(),status:'DRAFT',mode:ctx.mode,items,
      coverage:solution.coverage,objective:solution.objective.minCoverage,objectiveBreakdown:solution.objective,totalCost:solution.totalCostPence,
      explanation:`${ctx.mode === 'DEMO' ? 'Synthetic demo evidence' : ctx.mode === 'QLOO' ? 'Qloo fixed-universe affinity ranks' : ctx.mode === 'METADATA' ? 'Lexical metadata baseline' : 'Model-only speculative relevance'}. ${ctx.run.trigger==='REPAIR' && ctx.repairPolicy !== 'GLOBAL_FAIRNESS' ? 'Minimize changed slot assignments first; then maximize minimum cohort coverage, average coverage, diversity and savings.' : 'Maximize the least-served cohort first, then average coverage, diversity and savings.'} Human approval is required.`,
      evidenceId:ctx.evidence!.id,inputRevision:ctx.state.revision,
      ...(ctx.parent && ctx.run.trigger==='REPAIR' ? {repair:{keptFilmIds:items.filter(i=>ctx.parent!.items.some(p=>p.filmId===i.filmId)).map(i=>i.filmId),replacedFilmIds:ctx.parent.items.filter(p=>!items.some(i=>i.filmId===p.filmId)).map(p=>p.filmId),objectiveDelta:solution.objective.minCoverage-ctx.parent.objective}}:{}),
    };
    ctx.state.versions.push(ctx.version);
    return `Saved immutable draft ${ctx.version.id}. Approval is outside the graph and requires an explicit human request.`;
  }))
  .addEdge(START,'load_catalogue').addEdge('load_catalogue','validate_inputs').addEdge('validate_inputs','collect_evidence')
  .addEdge('collect_evidence','solve_constraints').addEdge('solve_constraints','verify_solution').addEdge('verify_solution','save_draft').addEdge('save_draft',END)
  .compile();

export async function generateProgramme(state: AppState, mode: EvidenceMode, options: {parent?: ProgrammeVersion;trigger?: WorkflowRun['trigger'];repairPolicy?: 'MINIMAL_CHANGE'|'GLOBAL_FAIRNESS'} = {}) {
  const run: WorkflowRun={id:randomUUID(),startedAt:stamp(),mode,status:'RUNNING',steps:[],trigger:options.trigger ?? 'GENERATE'};
  state.runs.push(run);
  const ctx:GenerationContext={state,run,mode,...options};
  try {
    // A fixed acyclic graph: six tool nodes, no model-controlled routing or unbounded loops.
    await workflow.invoke({ctx},{recursionLimit:12});
    run.status='SUCCEEDED';run.versionId=ctx.version!.id;
    return {version:ctx.version,run};
  } catch(error) {
    run.status='FAILED';run.error=error instanceof Error ? error.message : 'Unknown generation failure';
    if(mode==='QLOO') state.providerStatus.qlooStatus='BLOCKED_OR_INCOMPLETE';
    return {error:run.error,run};
  } finally {run.endedAt=stamp();}
}
export function currentViolations(state: AppState, version: ProgrammeVersion): string[] {
  const violations=validateProgramme({films:state.films,cohorts:state.cohorts,slots:state.slots,constraints:state.constraints,affinities:state.affinities},version.items);
  for(const item of version.items) {
    const slot=state.slots.find(s=>s.id===item.slotId);const film=state.films.find(f=>f.id===item.filmId);
    if(slot && (slot.startAt!==item.startAt || slot.endAt!==item.endAt || slot.format!==item.format))violations.push(`Slot snapshot changed: ${item.slotId}`);
    if(film && (film.title!==item.filmTitle || film.runtimeMinutes!==item.runtimeMinutes))violations.push(`Film snapshot changed: ${item.filmId}`);
  }
  return violations;
}
