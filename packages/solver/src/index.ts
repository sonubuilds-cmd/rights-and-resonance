import { z } from 'zod';
import {
  AffinityMatrixSchema, CohortSchema, ConstraintsSchema, FilmSchema, ProgrammeItemSchema,
  ProgrammeLockSchema, ScreeningSlotSchema,
  type AffinityMatrix, type Cohort, type CohortCoverage, type Constraints, type Film,
  type ProgrammeItem, type ProgrammeLock, type ProgrammeObjective, type ScreeningSlot,
} from '@rr/domain';

/** Exact exhaustive search is deliberately bounded: at most 30 candidates × 4 slots. */
export const MAX_FILMS = 30;
export const MAX_SLOTS = 4;
export const MAX_COHORTS = 3;
const compareIds=(a:string,b:string):number=>a<b?-1:a>b?1:0;
export const SolveInputSchema = z.object({
  films: z.array(FilmSchema).min(1).max(MAX_FILMS),
  cohorts: z.array(CohortSchema).min(1).max(MAX_COHORTS),
  slots: z.array(ScreeningSlotSchema).min(1).max(MAX_SLOTS),
  constraints: ConstraintsSchema, affinities: AffinityMatrixSchema,
  locks: z.array(ProgrammeLockSchema).max(MAX_SLOTS).optional(),
  repair: z.object({previousItems:z.array(ProgrammeItemSchema),policy:z.enum(['MINIMAL_CHANGE','GLOBAL_FAIRNESS'])}).optional(),
});
export type SolveInput = {
  films: Film[]; cohorts: Cohort[]; slots: ScreeningSlot[]; constraints: Constraints;
  affinities: AffinityMatrix; locks?: ProgrammeLock[];
  repair?: {previousItems: ProgrammeItem[]; policy:'MINIMAL_CHANGE'|'GLOBAL_FAIRNESS'};
};
export type SolverDiagnostics = {
  candidateUniverseIds: string[]; eligibleBySlot: Record<string,string[]>;
  excludedBySlot: Record<string,Record<string,string[]>>;
  missingEvidence: Array<{cohortId:string;filmId:string}>;
  assignmentsEvaluated: number; searchNodes: number;
};
export type SolveSuccess = {
  status:'OPTIMAL'; items:ProgrammeItem[]; coverage:CohortCoverage[]; objective:ProgrammeObjective;
  totalCostPence:number; diagnostics:SolverDiagnostics;
  policy:'GLOBAL_FAIRNESS'|'MINIMAL_CHANGE'; changes:number;
};
export type SolveFailure = {
  status:'INVALID_INPUT'|'INCOMPLETE_EVIDENCE'|'INFEASIBLE'; reason:string;
  diagnostics:SolverDiagnostics;
};
export type SolveResult = SolveSuccess | SolveFailure;

/** Human-readable deterministic eligibility reasons, independent of taste evidence. */
export function filmEligibility(film:Film,slot:ScreeningSlot,constraints:Constraints):string[] {
  const reasons:string[]=[];
  if(film.rights.available===null) reasons.push('Rights availability is unknown');
  else if(film.rights.available!==true) reasons.push('Rights are unavailable');
  if(film.rights.territory!==constraints.territory) reasons.push(`Rights territory ${film.rights.territory} does not match ${constraints.territory}`);
  const start=Date.parse(slot.startAt), end=Date.parse(slot.endAt);
  const screeningEnd=start+film.runtimeMinutes*60_000;
  if(start<Date.parse(film.rights.availableFrom)||screeningEnd>Date.parse(film.rights.availableTo)) reasons.push('Screening is outside the rights window');
  if(screeningEnd>end) reasons.push('Runtime exceeds the slot');
  if(!film.formats.includes(slot.format)) reasons.push(`Required ${slot.format} format is unavailable`);
  if(film.rights.feePence>constraints.budgetPence) reasons.push('Single-film fee exceeds the total budget');
  return reasons;
}

function duplicateIds(values:Array<{id:string}>,label:string):string[] {
  const ids=new Set<string>(), errors:string[]=[];
  for(const value of values) {if(ids.has(value.id)) errors.push(`Duplicate ${label} id: ${value.id}`);ids.add(value.id);}
  return errors;
}
function sortedSlots(slots:ScreeningSlot[]):ScreeningSlot[] {
  return [...slots].sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt)||compareIds(a.id,b.id));
}
function structuralErrors(input:SolveInput):string[] {
  const errors=[...duplicateIds(input.films,'film'),...duplicateIds(input.cohorts,'cohort'),...duplicateIds(input.slots,'slot')];
  const slots=sortedSlots(input.slots);
  for(let i=1;i<slots.length;i++) if(Date.parse(slots[i]!.startAt)<Date.parse(slots[i-1]!.endAt)) errors.push(`Screening slots overlap: ${slots[i-1]!.id} and ${slots[i]!.id}`);
  const lockedSlots=new Set<string>(), lockedFilms=new Set<string>();
  for(const lock of input.locks??[]) {
    if(!input.slots.some(slot=>slot.id===lock.slotId)) errors.push(`Unknown locked slot: ${lock.slotId}`);
    if(!input.films.some(film=>film.id===lock.filmId)) errors.push(`Unknown locked film: ${lock.filmId}`);
    if(lockedSlots.has(lock.slotId)) errors.push(`More than one lock for slot: ${lock.slotId}`);
    if(lockedFilms.has(lock.filmId)) errors.push(`Film is locked more than once: ${lock.filmId}`);
    lockedSlots.add(lock.slotId);lockedFilms.add(lock.filmId);
  }
  const previousSlots=new Set<string>();
  for(const item of input.repair?.previousItems??[]) {
    if(previousSlots.has(item.slotId)) errors.push(`Duplicate previous slot: ${item.slotId}`);
    previousSlots.add(item.slotId);
  }
  return errors;
}

/**
 * Average-rank percentiles on the entire fixed input catalogue, BEFORE eligibility filtering.
 * Lowest rank=0, highest=1; ties receive their average rank; a singleton receives 0.5.
 * Missing/null/non-finite scores are unknown, never silently imputed as zero.
 */
export function rankNormalizeAffinities(films:Film[],cohorts:Cohort[],affinities:AffinityMatrix):{
  matrix:AffinityMatrix;missing:Array<{cohortId:string;filmId:string}>;
} {
  const matrix:AffinityMatrix={},missing:Array<{cohortId:string;filmId:string}>=[];
  for(const cohort of cohorts) {
    const row:Record<string,number|null>={};matrix[cohort.id]=row;
    const known:Array<{filmId:string;value:number}>=[];
    for(const film of films) {
      const value=affinities[cohort.id]?.[film.id];
      if(typeof value!=='number'||!Number.isFinite(value)) {missing.push({cohortId:cohort.id,filmId:film.id});row[film.id]=null;}
      else known.push({filmId:film.id,value});
    }
    // Never normalize a partial response on a smaller universe: the entire row stays unknown.
    if(known.length!==films.length) {for(const film of films) row[film.id]=null;continue;}
    known.sort((a,b)=>a.value-b.value||compareIds(a.filmId,b.filmId));
    for(let start=0;start<known.length;) {
      let end=start+1;while(end<known.length&&known[end]!.value===known[start]!.value)end++;
      const percentile=known.length===1?0.5:((start+end-1)/2)/(known.length-1);
      for(let index=start;index<end;index++)row[known[index]!.filmId]=percentile;
      start=end;
    }
  }
  return {matrix,missing};
}

/** Validate today's constraints independently from stored fee snapshots or prior approvals. */
export function validateProgramme(input:SolveInput,items:ProgrammeItem[]):string[] {
  const parsed=SolveInputSchema.safeParse(input);
  if(!parsed.success)return parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`);
  const parsedItems=z.array(ProgrammeItemSchema).safeParse(items);
  if(!parsedItems.success)return parsedItems.error.issues.map(issue=>`items.${issue.path.join('.')}: ${issue.message}`);
  const errors=structuralErrors(input);
  if(items.length!==input.slots.length) errors.push('Programme must fill every slot exactly once');
  const seenFilms=new Set<string>(),seenSlots=new Set<string>();let total=0;
  for(const item of items) {
    if(seenFilms.has(item.filmId))errors.push(`Film appears more than once: ${item.filmId}`);
    if(seenSlots.has(item.slotId))errors.push(`Slot appears more than once: ${item.slotId}`);
    seenFilms.add(item.filmId);seenSlots.add(item.slotId);
    const film=input.films.find(f=>f.id===item.filmId),slot=input.slots.find(s=>s.id===item.slotId);
    if(!film)errors.push(`Unknown film: ${item.filmId}`);
    if(!slot)errors.push(`Unknown slot: ${item.slotId}`);
    if(film) {total+=film.rights.feePence;if(item.feePence!==film.rights.feePence)errors.push(`Fee changed for ${film.id}`);}
    if(film&&slot)for(const reason of filmEligibility(film,slot,input.constraints))errors.push(`${slot.id} / ${film.id}: ${reason}`);
  }
  for(const slot of input.slots)if(!seenSlots.has(slot.id))errors.push(`Slot is unfilled: ${slot.id}`);
  if(total>input.constraints.budgetPence)errors.push(`Programme costs ${total} pence, exceeding the ${input.constraints.budgetPence} pence budget`);
  for(const lock of input.locks??[])if(!items.some(item=>item.slotId===lock.slotId&&item.filmId===lock.filmId))errors.push(`Lock not satisfied: ${lock.slotId} / ${lock.filmId}`);
  return errors;
}

/** Lexicographic programme objective. Coverage averages the best two selected films per cohort. */
export function evaluateProgramme(
  items:ProgrammeItem[],films:Film[],cohorts:Cohort[],normalized:AffinityMatrix,budgetPence:number,
):{coverage:CohortCoverage[];objective:ProgrammeObjective;totalCostPence:number} {
  const byId=new Map(films.map(f=>[f.id,f]));
  const coverage:CohortCoverage[]=cohorts.map(cohort=>{
    const ranked=items.map(item=>({filmId:item.filmId,score:normalized[cohort.id]?.[item.filmId]}));
    if(ranked.some(item=>typeof item.score!=='number'||!Number.isFinite(item.score)))throw new Error(`Incomplete normalized evidence for ${cohort.id}`);
    ranked.sort((a,b)=>(b.score as number)-(a.score as number)||compareIds(a.filmId,b.filmId));
    const top=ranked.slice(0,2);
    return {cohortId:cohort.id,cohortName:cohort.name,score:top.reduce((sum,item)=>sum+(item.score as number),0)/Math.max(1,top.length),topFilmIds:top.map(item=>item.filmId)};
  });
  const genres=new Set<string>(),countries=new Set<string>();
  for(const item of items){const film=byId.get(item.filmId);if(!film)throw new Error(`Unknown film: ${item.filmId}`);for(const genre of film.genres)genres.add(genre);countries.add(film.country);}
  const totalCostPence=items.reduce((sum,item)=>sum+item.feePence,0);
  return {coverage,objective:{minCoverage:Math.min(...coverage.map(c=>c.score)),averageCoverage:coverage.reduce((sum,c)=>sum+c.score,0)/coverage.length,diversity:genres.size+countries.size,savingsPence:budgetPence-totalCostPence},totalCostPence};
}

export function solveProgramme(rawInput:SolveInput):SolveResult {
  const diagnostics:SolverDiagnostics={candidateUniverseIds:[],eligibleBySlot:{},excludedBySlot:{},missingEvidence:[],assignmentsEvaluated:0,searchNodes:0};
  const parsed=SolveInputSchema.safeParse(rawInput);
  if(!parsed.success)return {status:'INVALID_INPUT',reason:parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; '),diagnostics};
  const input=parsed.data;
  const films=[...input.films].sort((a,b)=>compareIds(a.id,b.id));
  const slots=sortedSlots(input.slots);
  diagnostics.candidateUniverseIds=films.map(film=>film.id);
  const errors=structuralErrors(input);
  if(errors.length)return {status:'INVALID_INPUT',reason:errors.join('; '),diagnostics};
  const normalized=rankNormalizeAffinities(films,input.cohorts,input.affinities);
  diagnostics.missingEvidence=normalized.missing;
  for(const slot of slots) {
    diagnostics.eligibleBySlot[slot.id]=[];diagnostics.excludedBySlot[slot.id]={};
    for(const film of films) {
      const reasons=filmEligibility(film,slot,input.constraints);
      if(reasons.length)diagnostics.excludedBySlot[slot.id]![film.id]=reasons;
      else diagnostics.eligibleBySlot[slot.id]!.push(film.id);
    }
  }
  if(normalized.missing.length)return {status:'INCOMPLETE_EVIDENCE',reason:`${normalized.missing.length} affinity scores are unknown on the fixed ${films.length}-film universe; no programme was generated`,diagnostics};
  const locks=new Map((input.locks??[]).map(lock=>[lock.slotId,lock.filmId]));
  const candidates=slots.map(slot=>films.filter(film=>diagnostics.eligibleBySlot[slot.id]!.includes(film.id)&&(!locks.has(slot.id)||locks.get(slot.id)===film.id)));
  if(candidates.some(list=>list.length===0))return {status:'INFEASIBLE',reason:'At least one slot has no eligible candidate satisfying its lock and operational constraints',diagnostics};
  const policy=input.repair?.policy??'GLOBAL_FAIRNESS';
  const previous=new Map((input.repair?.previousItems??[]).map(item=>[item.slotId,item.filmId]));
  let best:SolveSuccess|null=null;let bestKey='';
  const selected:ProgrammeItem[]=[];const used=new Set<string>();
  // Objective depends on selected set; cache repeated slot permutations without skipping feasibility.
  const objectiveCache=new Map<string,ReturnType<typeof evaluateProgramme>>();
  function better(result:Pick<SolveSuccess,'objective'|'changes'>,key:string,current:SolveSuccess):boolean {
    if(policy==='MINIMAL_CHANGE'&&result.changes!==current.changes)return result.changes<current.changes;
    const a=result.objective,b=current.objective;
    for(const field of ['minCoverage','averageCoverage','diversity','savingsPence'] as const) {
      const delta=a[field]-b[field];
      if(Math.abs(delta)>1e-12)return delta>0;
    }
    return key<bestKey;
  }
  function search(depth:number,cost:number):void {
    diagnostics.searchNodes++;
    if(depth===slots.length) {
      diagnostics.assignmentsEvaluated++;
      const setKey=JSON.stringify([...used].sort(compareIds));
      let evaluated=objectiveCache.get(setKey);
      if(!evaluated) {evaluated=evaluateProgramme(selected,films,input.cohorts,normalized.matrix,input.constraints.budgetPence);objectiveCache.set(setKey,evaluated);}
      const changes=input.repair?selected.filter(item=>previous.get(item.slotId)!==item.filmId).length:0;
      const key=JSON.stringify(selected.map(item=>[item.slotId,item.filmId]));
      const result={...evaluated,changes};
      if(best===null||better(result,key,best)) {best={status:'OPTIMAL',items:selected.map(item=>({...item})),...result,diagnostics,policy};bestKey=key;}
      return;
    }
    for(const film of candidates[depth]!) {
      if(used.has(film.id))continue;
      const nextCost=cost+film.rights.feePence;
      if(nextCost>input.constraints.budgetPence)continue;
      // Admissible budget lower bound; ignores distinctness and can only underestimate.
      let minimumRemaining=0;
      for(let next=depth+1;next<candidates.length;next++) {
        let cheapest=Infinity;
        for(const candidate of candidates[next]!)if(candidate.id!==film.id&&!used.has(candidate.id))cheapest=Math.min(cheapest,candidate.rights.feePence);
        minimumRemaining+=cheapest;
      }
      if(nextCost+minimumRemaining>input.constraints.budgetPence)continue;
      used.add(film.id);selected.push({slotId:slots[depth]!.id,filmId:film.id,feePence:film.rights.feePence});
      search(depth+1,nextCost);selected.pop();used.delete(film.id);
    }
  }
  search(0,0);
  return best??{status:'INFEASIBLE',reason:'No complete distinct-film programme satisfies the current rights, slots, locks and total budget',diagnostics};
}
