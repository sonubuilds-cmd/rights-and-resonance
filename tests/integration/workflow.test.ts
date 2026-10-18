import { afterEach, describe, expect, it, vi } from 'vitest';
import type {FastifyInstance,InjectOptions} from '../../apps/api/src/server.js';
import { makeServer } from '../../apps/api/src/server.js';
import {randomUUID} from 'node:crypto';
import {qloo} from '../../apps/api/src/evidence.js';
import {resetLiveVerification} from '../../apps/api/src/live-status.js';
import {MemoryStore} from '../../apps/api/src/store.js';
import {createInitialState} from '../../apps/api/src/state.js';
import type {QlooInsightsResult,QlooResult} from '@rr/qloo';
import type { AppState, ProgrammeVersion } from '../../apps/api/src/types.js';

const servers:FastifyInstance[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>s.close()));vi.restoreAllMocks();vi.unstubAllEnvs();});
async function client(factory?:()=>AppState) {
  const app=await makeServer(factory?{store:new MemoryStore(factory)}:{});servers.push(app);
  const first=await app.inject({method:'GET',url:'/api/state'});
  const cookie=String(first.headers['set-cookie']).split(';')[0]!;
  return {app,cookie,initial:first.json<AppState>(),request:(options:InjectOptions)=>app.inject({...options,headers:{cookie,origin:'http://localhost:5173',...options.headers}})};
}
async function generate(c:Awaited<ReturnType<typeof client>>) {
  const response=await c.request({method:'POST',url:'/api/programmes/generate',payload:{mode:'DEMO'}});
  expect(response.statusCode,response.body).toBe(200);
  const state=response.json<AppState>();return{state,version:state.versions.at(-1)!};
}
async function approve(c:Awaited<ReturnType<typeof client>>,version:ProgrammeVersion) {
  return c.request({method:'POST',url:`/api/programmes/${version.programmeId}/approve`,payload:{versionId:version.id}});
}

process.env.QLOO_PRECONFIRMED_MAPPINGS='off'; // these tests build their own mapping states
describe('session-scoped programme workflow',()=>{
  it('generates, explicitly approves, revokes, repairs and reapproves without mutating snapshots',async()=>{
    const c=await client();const {state,version}=await generate(c);
    expect(state.runs.at(-1)?.steps.map(s=>s.node)).toEqual(['load_catalogue','validate_inputs','collect_evidence','solve_constraints','verify_solution','save_draft']);
    expect(version.status).toBe('DRAFT');expect(version.items).toHaveLength(4);
    expect(version.objectiveBreakdown.minCoverage).toBe(version.objective);
    const blocked=await c.request({method:'GET',url:`/api/programme-versions/${version.id}/export`});expect(blocked.statusCode).toBe(409);
    const approved=await approve(c,version);expect(approved.statusCode,approved.body).toBe(200);
    const original=approved.json<AppState>().versions.find(v=>v.id===version.id)!;expect(original.status).toBe('APPROVED');
    const revoke=await c.request({method:'POST',url:'/api/events/rights-revoked',payload:{filmId:original.items[0]!.filmId,reason:'Distributor withdrawal'}});
    expect(revoke.statusCode,revoke.body).toBe(200);
    const changed=revoke.json<AppState>();const old=changed.versions.find(v=>v.id===version.id)!;const repaired=changed.versions.at(-1)!;
    expect(old.status).toBe('INVALIDATED');expect(old.items).toEqual(original.items);expect(old.objectiveBreakdown).toEqual(original.objectiveBreakdown);
    expect(repaired.status).toBe('DRAFT');expect(repaired.parentVersionId).toBe(original.id);
    expect(repaired.items.some(i=>i.filmId===original.items[0]!.filmId)).toBe(false);
    expect(changed.events.at(-1)?.invalidatedVersionIds).toContain(original.id);
    expect(changed.events.at(-1)?.repairedVersionId).toBe(repaired.id);
    const reapproved=await approve(c,repaired);expect(reapproved.statusCode,reapproved.body).toBe(200);
    const twice=await approve(c,repaired);expect(twice.statusCode).toBe(200);
    expect(twice.json<AppState>().events.filter(e=>e.type==='HUMAN_APPROVAL')).toHaveLength(2);
    const evidence=await c.request({method:'GET',url:`/api/programme-versions/${original.id}/evidence`});
    expect(evidence.json().inputs.films.find((f:{id:string})=>f.id===original.items[0]!.filmId).rights.available).toBe(true);
    expect(evidence.json().sourceLabel).toBe('SYNTHETIC_DEMO');
    const output=await c.request({method:'GET',url:`/api/programme-versions/${repaired.id}/export`});expect(output.statusCode).toBe(200);
    const diff=await c.request({method:'GET',url:`/api/programme-versions/${original.id}/diff/${repaired.id}`});expect(diff.json().changes.filter((d:{changed:boolean})=>d.changed)).toHaveLength(1);
  });
  it('commits invalidation and failure when no feasible repair exists',async()=>{
    const c=await client();const{version}=await generate(c);await approve(c,version);
    const result=await c.request({method:'POST',url:'/api/events/budget-changed',payload:{budgetPence:0}});
    expect(result.statusCode,result.body).toBe(200);const state=result.json<AppState>();
    expect(state.constraints.budgetPence).toBe(0);expect(state.versions).toHaveLength(1);expect(state.versions[0]!.status).toBe('INVALIDATED');
    expect(state.events.at(-1)?.repairError).toContain('INFEASIBLE');expect(state.runs.at(-1)?.status).toBe('FAILED');
    const reload=await c.request({method:'GET',url:'/api/state'});expect(reload.json<AppState>().events.at(-1)?.repairError).toContain('INFEASIBLE');
    expect((await approve(c,version)).statusCode).toBe(409);
  });
  it('rejects stale drafts and supersedes previous approvals while preserving old items',async()=>{
    const c=await client();const{version}=await generate(c);
    const cohort=c.initial.cohorts[0]!;
    const edit=await c.request({method:'PUT',url:`/api/cohorts/${cohort.id}/seeds`,payload:{seeds:[...cohort.seeds,{name:'New taste seed',domain:'books'}]}});
    expect(edit.statusCode,edit.body).toBe(200);
    const stale=await approve(c,version);expect(stale.statusCode).toBe(409);expect(stale.json().error).toBe('STALE_DRAFT');
    const current=edit.json<AppState>().versions.at(-1)!;expect((await approve(c,current)).statusCode).toBe(200);
    const next=await generate(c);const fresh=await approve(c,next.version);expect(fresh.statusCode).toBe(200);
    const superseded=fresh.json<AppState>().versions.find(v=>v.id===current.id)!;expect(superseded.status).toBe('SUPERSEDED');expect(superseded.items).toEqual(current.items);
  });
  it('isolates fresh visitors and rejects untrusted origins, unknown rights and fake LLM evidence',async()=>{
    const c=await client();const{version}=await generate(c);
    const second=await c.app.inject({method:'GET',url:'/api/state'});expect(second.json<AppState>().versions).toHaveLength(0);expect(second.headers['set-cookie']).not.toEqual(c.cookie);
    const denied=await c.request({method:'POST',url:'/api/demo/reset',headers:{origin:'https://attacker.example'},payload:{}});expect(denied.statusCode).toBe(403);
    const film=c.initial.films.find(f=>f.id===version.items[0]!.filmId)!;
    const unknown=await c.request({method:'PATCH',url:`/api/films/${film.id}`,payload:{rights:{...film.rights,available:null}}});expect(unknown.statusCode,unknown.body).toBe(200);
    const latest=unknown.json<AppState>().versions.at(-1)!;expect(latest.items.some(i=>i.filmId===film.id)).toBe(false);
    if(!process.env.LLM_API_KEY || !process.env.LLM_MODEL) {
      const llm=await c.request({method:'POST',url:'/api/programmes/generate',payload:{mode:'LLM_ONLY'}});expect(llm.statusCode).toBe(503);expect(llm.json().state.runs.at(-1).status).toBe('FAILED');expect(llm.json().message).toContain('No simulated LLM');
    }
  });
  it('records an unrelated withdrawal without requerying or repairing approved decisions',async()=>{
    const c=await client();const{state,version}=await generate(c);await approve(c,version);
    const unselected=state.films.find(f=>!version.items.some(i=>i.filmId===f.id))!;
    const event=await c.request({method:'POST',url:'/api/events',payload:{type:'RIGHTS_REVOKED',filmId:unselected.id}});
    const current=event.json<AppState>();expect(current.versions).toHaveLength(1);expect(current.versions[0]!.status).toBe('APPROVED');expect(current.runs).toHaveLength(1);expect(current.events.at(-1)?.invalidatedVersionIds).toEqual([]);
  });
});

const fixtureEvidence={source:'QLOO' as const,transport:'harness' as const,endpoint:'/v2/insights' as const,baseUrl:'https://hackathon.api.qloo.com',requestHash:'test-request-hash',responseHash:'test-response-hash',fetchedAt:'2026-10-01T12:00:00Z',servedAt:'2026-10-01T12:00:00Z',cache:'LIVE' as const,attempts:1,httpStatus:200};
function mappedState(count=30) {
  const state=createInitialState();
  state.films.slice(0,count).forEach(f=>{f.qlooEntityId=randomUUID();f.mappingStatus='CONFIRMED';});
  state.cohorts.forEach(c=>c.seeds.forEach(seed=>{seed.entityId=randomUUID();}));return state;
}
function insights(ids:string[],complete=true,reverse=false):QlooInsightsResult {
  return {status:complete?'complete':'partial',entities:[],raw:{success:true,fixture:complete?'complete mocked response':'partial mocked response'},evidence:fixtureEvidence,warnings:complete?[]:['Missing affinity fixture'],rows:ids.map((entityId,index)=>({entityId,rawAffinity:complete?index/ids.length:null,percentile:complete?(reverse?1-index/(ids.length-1):index/(ids.length-1)):null})),candidateUniverse:ids,missingEntityIds:complete?[]:ids,complete};
}
describe('live-provider boundary guards using mocks only',()=>{
  it('clears a confirmed Qloo identity after changing a film title or release year',async()=>{
    const c=await client(()=>mappedState()); const film=c.initial.films[0]!;
    const edited=await c.request({method:'PATCH',url:`/api/films/${film.id}`,payload:{title:'A different synthetic film'}});
    expect(edited.statusCode).toBe(200);
    const state=edited.json<AppState>(); const changed=state.films.find(f=>f.id===film.id)!;
    expect(changed.qlooEntityId).toBeNull(); expect(changed.mappingStatus).toBe('UNMAPPED'); expect(state.mappings[film.id]).toBeUndefined();
  });
  it('deduplicates confirmed seed identities before requesting Qloo profiles',async()=>{
    vi.stubEnv('QLOO_API_KEY','test-key-never-sent');
    const c=await client(()=>{const state=mappedState();for(const cohort of state.cohorts)cohort.seeds[1]!.entityId=cohort.seeds[0]!.entityId;return state;});
    const provider=vi.spyOn(qloo(),'insights').mockImplementation(async request=>{expect(new Set(request.seedEntityIds).size).toBe(request.seedEntityIds.length);expect(request.seedEntityIds).toHaveLength(2);return insights(request.candidateEntityIds);});
    const response=await c.request({method:'POST',url:'/api/programmes/generate',payload:{mode:'QLOO'}});
    expect(response.statusCode,response.body).toBe(200);expect(provider).toHaveBeenCalledTimes(3);
  });
  it('retains partial Qloo raw evidence without producing a programme or zero-filling',async()=>{
    vi.stubEnv('QLOO_API_KEY','test-key-never-sent');
    const c=await client(()=>mappedState(25));
    vi.spyOn(qloo(),'insights').mockImplementation(async request=>insights(request.candidateEntityIds,false));
    const response=await c.request({method:'POST',url:'/api/programmes/generate',payload:{mode:'QLOO'}});
    expect(response.statusCode).toBe(422);const state=response.json().state as AppState;
    expect(state.versions).toHaveLength(0);expect(state.runs.at(-1)?.status).toBe('FAILED');
    const evidence=state.evidence.at(-1)!;expect(evidence.status).toBe('PARTIAL');expect(evidence.candidateFilmIds).toHaveLength(25);expect(evidence.excludedFilmIds).toHaveLength(5);
    expect(evidence.providerResponses).toHaveLength(1);expect(evidence.providerResponses[0]).toMatchObject({raw:{fixture:'partial mocked response'}});
    expect(state.runs.at(-1)?.evidenceId).toBe(evidence.id);
    expect(Object.values(evidence.affinities).flatMap(Object.values).every(value=>value===null)).toBe(true);
    expect((await c.request({method:'GET',url:`/api/evidence/${evidence.id}`})).statusCode).toBe(200);
  });
  it('treats a catalogue film that is also a cohort seed as unknown-for-that-cohort, not incomplete and not zero',async()=>{
    vi.stubEnv('QLOO_API_KEY','test-key-never-sent');resetLiveVerification();
    const seedFilmIndex=0;
    const c=await client(()=>{const state=mappedState();state.cohorts[0]!.seeds[0]!.entityId=state.films[seedFilmIndex]!.qlooEntityId!;return state;});
    const provider=vi.spyOn(qloo(),'insights').mockImplementation(async request=>{
      const seeds=new Set(request.seedEntityIds);const known=request.candidateEntityIds.filter(id=>!seeds.has(id));
      const rows=request.candidateEntityIds.map(entityId=>seeds.has(entityId)?{entityId,rawAffinity:null,percentile:null,excludedAsSeed:true}:{entityId,rawAffinity:0.5,percentile:known.indexOf(entityId)/(known.length-1)});
      return {...insights(request.candidateEntityIds),rows,missingEntityIds:[],complete:true};
    });
    const response=await c.request({method:'POST',url:'/api/programmes/generate',payload:{mode:'QLOO'}});
    expect(response.statusCode,response.body).toBe(200);expect(provider).toHaveBeenCalledTimes(3);
    const state=response.json<AppState>();const evidence=state.evidence.at(-1)!;const seedFilm=state.films[seedFilmIndex]!;
    expect(evidence.status).toBe('COMPLETE');expect(evidence.seedExcluded).toEqual({[state.cohorts[0]!.id]:[seedFilm.id]});
    expect(evidence.affinities[state.cohorts[0]!.id]![seedFilm.id]).toBeNull();
    expect(evidence.affinities[state.cohorts[1]!.id]![seedFilm.id]).not.toBeNull();
    expect(evidence.warnings.join(' ')).toContain("doesn't score a seed against itself");
    const version=state.versions.at(-1)!;expect(version.items).toHaveLength(4);
    expect(version.coverage.every(cv=>Number.isFinite(cv.score))).toBe(true);
    expect(state.providerStatus.qlooVerifiedAt).toBeTruthy();expect(state.providerStatus.qlooVerifiedVia).toBe('EVIDENCE');
  });
  it('still blocks when a non-seed film lacks Qloo affinity, and does not mark live verified',async()=>{
    vi.stubEnv('QLOO_API_KEY','test-key-never-sent');resetLiveVerification();
    const c=await client(()=>mappedState());
    vi.spyOn(qloo(),'insights').mockImplementation(async request=>{
      const r=insights(request.candidateEntityIds);r.rows[3]={entityId:r.rows[3]!.entityId,rawAffinity:null,percentile:null};return r;
    });
    const response=await c.request({method:'POST',url:'/api/programmes/generate',payload:{mode:'QLOO'}});
    expect(response.statusCode).toBe(422);expect(response.json().state.providerStatus.qlooVerifiedAt).toBeUndefined();
  });
  it('invalidates current approval when a fresh complete Qloo profile changes ranks',async()=>{
    vi.stubEnv('QLOO_API_KEY','test-key-never-sent');const c=await client(()=>mappedState());
    const mock=vi.spyOn(qloo(),'insights').mockImplementation(async request=>insights(request.candidateEntityIds));
    const generated=await c.request({method:'POST',url:'/api/programmes/generate',payload:{mode:'QLOO'}});expect(generated.statusCode,generated.body).toBe(200);
    const before=generated.json<AppState>().versions.at(-1)!;expect((await approve(c,before)).statusCode).toBe(200);
    mock.mockImplementation(async request=>insights(request.candidateEntityIds,true,true));
    const profile=await c.request({method:'POST',url:'/api/qloo/profile-all',payload:{}});expect(profile.statusCode,profile.body).toBe(200);
    const state=profile.json<AppState>();expect(state.versions[0]!.status).toBe('INVALIDATED');expect(state.versions[0]!.items).toEqual(before.items);
    expect(state.events.at(-1)?.type).toBe('CULTURAL_EVIDENCE_UPDATED');expect(state.versions).toHaveLength(1);
    expect((await approve(c,before)).statusCode).toBe(409);
  });
  it('requires fresh movie mapping, rejects duplicates and checks declared seed entity types',async()=>{
    const c=await client();const entityId=randomUUID();
    const result=(type:string,cache:'LIVE'|'STALE_CACHE'='LIVE'):QlooResult=>({status:'complete',entities:[{entityId,name:'Verified fixture',type,releaseYear:2001,rawAffinity:null,raw:{}}],raw:{success:true},evidence:{...fixtureEvidence,endpoint:'/entities',cache},warnings:[]});
    const entities=vi.spyOn(qloo(),'entities').mockResolvedValue(result('urn:entity:artist'));
    const filmId=c.initial.films[0]!.id;
    expect((await c.request({method:'POST',url:'/api/qloo/confirm',payload:{filmId,entityId}})).statusCode).toBe(422);
    entities.mockResolvedValue(result('urn:entity:movie','STALE_CACHE'));
    expect((await c.request({method:'POST',url:'/api/qloo/confirm',payload:{filmId,entityId}})).statusCode).toBe(422);
    entities.mockResolvedValue(result('urn:entity:movie'));
    expect((await c.request({method:'POST',url:'/api/qloo/confirm',payload:{filmId,entityId}})).statusCode).toBe(200);
    expect((await c.request({method:'POST',url:'/api/qloo/confirm',payload:{filmId:c.initial.films[1]!.id,entityId}})).statusCode).toBe(409);
    const cohort=c.initial.cohorts[0]!;const seeds=[{name:'Wrong type fixture',domain:'books',entityId},...cohort.seeds.slice(1)];
    expect((await c.request({method:'PUT',url:`/api/cohorts/${cohort.id}/seeds`,payload:{seeds}})).statusCode).toBe(422);
    const bypass=await c.request({method:'PATCH',url:`/api/films/${filmId}`,payload:{qlooEntityId:randomUUID(),mappingStatus:'CONFIRMED'}});expect(bypass.statusCode).toBe(400);
    const imported=await c.request({method:'POST',url:'/api/films',payload:{...c.initial.films[0],id:'new-film',qlooEntityId:entityId,mappingStatus:'CONFIRMED'}});expect(imported.statusCode).toBe(400);
  });
});
