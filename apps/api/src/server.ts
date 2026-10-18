export type { FastifyInstance, InjectOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { FilmSchema, CohortSchema, CohortSeedSchema, FilmFormatSchema, ScreeningSlotSchema, EvidenceModeSchema } from '@rr/domain';
import { filmEligibility } from '@rr/solver';
import { QlooError } from '@rr/qloo';
import { MemoryStore, PostgresStore, type StateStore } from './store.js';
import { createInitialState, currentProviderConfiguration, defaultEvidenceMode } from './state.js';
import { generateProgramme, currentViolations } from './workflow.js';
import { ApiError, applyChange, approveVersion, findVersion, getCohort, getFilm, rightsEnquiryText } from './operations.js';
import { createTasteSource, type TasteDnaSource } from './taste.js';
import { collectAffinities, qloo, recordEvidence, EvidenceCollectionError } from './evidence.js';
import { registerMcpRoutes, isMcpPath } from './mcp-http.js';
import { registerAgentRoutes, AgentHttpError, type GenerateFn } from './agent-chat.js';
import { registerWebHost, resolveWebRoot, isWebPath } from './static.js';
import type { AppState, ProgrammeEvent, ProgrammeVersion, EvidenceMode } from './types.js';

const idSchema=z.string().min(1).max(120);
const seedSchema=z.array(CohortSeedSchema.extend({entityId:z.string().uuid().nullable().optional()})).min(2).max(12);
const cohortPatch=z.object({name:z.string().min(1).max(160).optional(),description:z.string().min(1).max(2000).optional(),seeds:seedSchema.optional()}).strict();
const eventSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('RIGHTS_REVOKED'),filmId:idSchema,reason:z.string().max(500).optional()}).strict(),
  z.object({type:z.literal('FORMAT_UNAVAILABLE'),filmId:idSchema,format:FilmFormatSchema}).strict(),
  z.object({type:z.literal('FORMAT_CHANGED'),filmId:idSchema,formats:z.array(FilmFormatSchema).min(1).max(4)}).strict(),
  z.object({type:z.literal('FEE_CHANGED'),filmId:idSchema,feePence:z.number().int().nonnegative().max(100_000_000)}).strict(),
  z.object({type:z.literal('BUDGET_CHANGED'),budgetPence:z.number().int().nonnegative().max(100_000_000)}).strict(),
  z.object({type:z.literal('SLOT_CHANGED'),slotId:idSchema,startAt:z.string().datetime({offset:true}).optional(),endAt:z.string().datetime({offset:true}).optional(),format:FilmFormatSchema.optional()}).strict(),
  z.object({type:z.literal('COHORT_UPDATED'),cohortId:idSchema,name:z.string().min(1).max(160).optional(),description:z.string().min(1).max(2000).optional(),seeds:seedSchema.optional()}).strict(),
]);
const seedTypes:Record<string,string>={music:'urn:entity:artist',artist:'urn:entity:artist',books:'urn:entity:book',book:'urn:entity:book',places:'urn:entity:place',brands:'urn:entity:brand',film:'urn:entity:movie',movie:'urn:entity:movie',tv:'urn:entity:tv_show',video_game:'urn:entity:videogame'};
async function validateSeedMappings(seeds:z.infer<typeof seedSchema>|undefined) {
  if(!seeds?.some(seed=>seed.entityId))return;
  const ids=[...new Set(seeds.filter(seed=>seed.entityId).map(seed=>z.string().uuid().parse(seed.entityId).toLowerCase()))];
  const resolved=await qloo().entities(ids);
  if(resolved.status!=='complete'||resolved.evidence.cache==='STALE_CACHE')throw new ApiError(422,'SEED_MAPPING_UNVERIFIED','Complete fresh entity evidence is required to confirm seed mappings');
  for(const seed of seeds.filter(seed=>seed.entityId)) {
    const entity=resolved.entities.find(e=>e.entityId===seed.entityId!.toLowerCase());
    if(!entity||entity.type!==seedTypes[seed.domain])throw new ApiError(422,'SEED_TYPE_MISMATCH',`Resolved entity does not match the declared ${seed.domain} seed type`);
    seed.entityId=entity.entityId;
  }
}
const clone=<T>(value:T):T=>structuredClone(value);
const now=()=>new Date().toISOString();
function bodyObject(req:FastifyRequest):Record<string,unknown> {return z.record(z.unknown()).parse(req.body ?? {});}
function sessionId(req:FastifyRequest) {return (req as FastifyRequest & {rrSession:string}).rrSession;}
function param(req:FastifyRequest,key:string) {return z.record(idSchema).parse(req.params)[key]!;}

export async function makeServer(options:{store?:StateStore;logger?:boolean;taste?:TasteDnaSource;agentGenerate?:GenerateFn;agentConfig?:Partial<import('./agent-chat.js').AgentConfig>}={}) {
  const app=Fastify({logger:options.logger ?? false,bodyLimit:256*1024,trustProxy:false});
  const allowed=new Set((process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:3001,http://127.0.0.1:5173,http://127.0.0.1:3001').split(',').map(s=>s.trim()).filter(Boolean));
  await app.register(cookie);
  await app.register(cors,{origin:(origin,cb)=>cb(null,!origin||allowed.has(origin)),credentials:true,methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'],exposedHeaders:['Mcp-Session-Id']});
  const webRoot=resolveWebRoot();
  await app.register(rateLimit,{max:120,timeWindow:'1 minute',keyGenerator:request=>request.ip,allowList:request=>!!webRoot&&isWebPath(request.url)});
  let store=options.store;
  if(!store && process.env.DATABASE_URL) {const pg=new PostgresStore(process.env.DATABASE_URL,()=>createInitialState('postgres'));await pg.migrate();store=pg;}
  store??=new MemoryStore(()=>createInitialState('memory'));
  const data=store;
  app.addHook('onClose',async()=>data.close());
  app.decorateRequest('rrSession','');
  app.addHook('preSerialization',async(_req,_reply,payload)=>{
    // Persisted sessions may outlive server configuration. Refresh availability only;
    // historical workflow status and immutable evidence are not live setup checks.
    if(payload && typeof payload==='object') {
      const state='state' in payload?payload.state:payload;
      if(state && typeof state==='object' && 'providerStatus' in state && 'films' in state && Array.isArray(state.films) && state.providerStatus && typeof state.providerStatus==='object') {
        Object.assign(state.providerStatus,currentProviderConfiguration());
      }
    }
    return payload;
  });
  app.addHook('onRequest',async(req,reply)=>{
    if(req.url==='/healthz'||(webRoot&&isWebPath(req.url)))return;
    const origin=req.headers.origin;
    if(origin && !allowed.has(origin))throw new ApiError(403,'ORIGIN_DENIED','This Origin is not in the server allowlist');
    // /mcp is for non-browser MCP clients: no cookie session, no CSRF gate (they send no Origin). A present Origin was
    // already checked above (DNS-rebinding protection). Each MCP session gets its own workspace inside mcp-http.ts.
    if(isMcpPath(req.url)){reply.header('Cache-Control','no-store');return;}
    if(req.method!=='GET'&&req.method!=='OPTIONS'&&!origin&&req.headers['sec-fetch-site']==='cross-site')throw new ApiError(403,'CSRF_BLOCKED','Cross-site mutation requires an allowed Origin');
    let sid=req.cookies.rr_session;
    if(!sid || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sid)) {
      sid=randomUUID();
      reply.setCookie('rr_session',sid,{httpOnly:true,secure:process.env.COOKIE_SECURE==='true',sameSite:(process.env.COOKIE_SAME_SITE==='none'?'none':'lax'),path:'/',maxAge:60*60*24*7});
    }
    (req as FastifyRequest & {rrSession:string}).rrSession=sid;
    reply.header('Cache-Control','no-store');
  });
  app.setErrorHandler((error,_req,reply)=>{
    if(error instanceof ZodError) return reply.status(400).send({error:'INVALID_REQUEST',message:'Request validation failed',details:error.issues});
    if(error instanceof AgentHttpError)return reply.status(error.statusCode).send({error:error.code,message:error.message,...error.extra});
    if(error instanceof ApiError)return reply.status(error.statusCode).send({error:error.code,message:error.message,details:error.details});
    if(error instanceof QlooError) return reply.status(error.code==='NOT_CONFIGURED'?503:502).send({error:`QLOO_${error.code}`,message:error.message,details:{httpStatus:error.httpStatus,retryable:error.retryable,...error.metadata}});
    const status=error instanceof Error && 'statusCode' in error && typeof error.statusCode==='number' ? error.statusCode : 500;
    return reply.status(status).send({error:status===500?'INTERNAL_ERROR':'REQUEST_ERROR',message:status===500?'Request failed safely. Check server diagnostics.':error instanceof Error?error.message:'Request failed'});
  });
  app.get('/healthz',async()=>({ok:true,persistence:data.kind}));
  app.get('/api/state',async req=>data.read(sessionId(req)));
  // Inspect local configuration and installed transport capabilities only. Never probe Qloo here.
  // Taste DNA: provider seam in ./taste.ts. Same origin/session hooks as every other route.
  const tasteSource=options.taste ?? createTasteSource();
  app.get('/api/taste',async()=>tasteSource.load());
  app.get('/api/qloo/readiness',async()=>qloo().readiness());
  app.post('/api/demo/reset',async req=>data.reset(sessionId(req)));
  app.get('/api/films',async req=>{const s=await data.read(sessionId(req));return{films:s.films,eligibility:s.films.flatMap(f=>s.slots.map(slot=>{const reasons=filmEligibility(f,slot,s.constraints);return{filmId:f.id,slotId:slot.id,eligible:reasons.length===0,reasons};}))};});
  app.post('/api/films',async req=>{
    const film=FilmSchema.omit({qlooEntityId:true,mappingStatus:true}).strict().parse(req.body);
    const newFilm={...film,qlooEntityId:null,mappingStatus:'UNMAPPED' as const};
    return data.update(sessionId(req),s=>{
      if(s.films.length>=30)throw new ApiError(400,'CATALOGUE_LIMIT','This bounded demo supports 30 films; edit an existing film');
      if(s.films.some(f=>f.id===film.id))throw new ApiError(409,'DUPLICATE_ID','Film ID already exists');
      return applyChange(s,'FILM_ADDED',{filmId:film.id},()=>{s.films.push(newFilm);},true);
    });
  });
  app.patch('/api/films/:id',async req=>{
    const patch=FilmSchema.omit({id:true,qlooEntityId:true,mappingStatus:true}).partial().strict().parse(req.body);
    return data.update(sessionId(req),s=>{const film=getFilm(s,param(req,'id'));return applyChange(s,'FILM_UPDATED',{filmId:film.id,changedFields:Object.keys(patch)},()=>{
      const identityChanged = (patch.title !== undefined && patch.title !== film.title) || (patch.year !== undefined && patch.year !== film.year);
      Object.assign(film,patch);
      if (identityChanged) { film.qlooEntityId=null; film.mappingStatus='UNMAPPED'; delete s.mappings[film.id]; }
    },Object.keys(patch).some(key=>['title','year','genres','themes','country'].includes(key)));});
  });
  app.get('/api/cohorts',async req=>(await data.read(sessionId(req))).cohorts);
  app.post('/api/cohorts',async req=>{
    const cohort=CohortSchema.extend({seeds:seedSchema}).strict().parse(req.body);await validateSeedMappings(cohort.seeds);
    return data.update(sessionId(req),s=>{if(s.cohorts.length>=3)throw new ApiError(400,'COHORT_LIMIT','This bounded demo supports three cohorts; edit an existing cohort');if(s.cohorts.some(c=>c.id===cohort.id))throw new ApiError(409,'DUPLICATE_ID','Cohort ID already exists');return applyChange(s,'COHORT_ADDED',{cohortId:cohort.id},()=>{s.cohorts.push(cohort);},true);});
  });
  const editCohort=async(req:FastifyRequest)=>{
    const patch=cohortPatch.parse(req.body);await validateSeedMappings(patch.seeds);return data.update(sessionId(req),s=>{const cohort=getCohort(s,param(req,'id'));return applyChange(s,'COHORT_UPDATED',{cohortId:cohort.id,changedFields:Object.keys(patch)},()=>Object.assign(cohort,patch),true);});
  };
  app.post('/api/cohorts/:id',editCohort);app.patch('/api/cohorts/:id',editCohort);app.put('/api/cohorts/:id/seeds',editCohort);
  app.post('/api/programmes/generate',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async(req,reply)=>{
    const body=z.object({mode:EvidenceModeSchema.optional()}).strict().parse(req.body ?? {});
    const result=await data.update(sessionId(req),async s=>{const generated=await generateProgramme(s,body.mode ?? defaultEvidenceMode(),{parent:s.versions.at(-1)});return{state:s,error:generated.error};});
    if(result.error)return reply.status(result.error.includes('NOT_CONFIGURED')?503:422).send({error:'GENERATION_BLOCKED',message:result.error,state:result.state});
    return result.state;
  });
  app.get('/api/programmes/:id',async req=>{const s=await data.read(sessionId(req));const versions=s.versions.filter(v=>v.programmeId===param(req,'id'));if(!versions.length)throw new ApiError(404,'NOT_FOUND','Programme not found');return{programmeId:param(req,'id'),current:versions.at(-1),versions};});
  app.get('/api/programmes/:id/versions',async req=>(await data.read(sessionId(req))).versions.filter(v=>v.programmeId===param(req,'id')));
  app.post('/api/programmes/:id/approve',async req=>{
    const {versionId}=z.object({versionId:idSchema}).strict().parse(req.body);
    return data.update(sessionId(req),s=>approveVersion(s,versionId,param(req,'id')));
  });
  app.post('/api/programmes/:id/repair',async(req,reply)=>{
    const body=z.object({versionId:idSchema,policy:z.enum(['MINIMAL_CHANGE','GLOBAL_FAIRNESS']).default('MINIMAL_CHANGE')}).strict().parse(req.body);
    const result=await data.update(sessionId(req),async s=>{const parent=findVersion(s,body.versionId);if(parent.programmeId!==param(req,'id'))throw new ApiError(409,'PROGRAMME_MISMATCH','Version does not belong to programme');const generated=await generateProgramme(s,parent.mode,{parent,trigger:'REPAIR',repairPolicy:body.policy});return{state:s,error:generated.error};});
    if(result.error)return reply.status(422).send({error:'REPAIR_BLOCKED',message:result.error,state:result.state});return result.state;
  });
  const handleEvent=async(req:FastifyRequest,override?:string)=>{
    const body=eventSchema.parse({...bodyObject(req),...(override?{type:override}:{})});
    if(body.type==='COHORT_UPDATED')await validateSeedMappings(body.seeds);
    return data.update(sessionId(req),s=>applyChange(s,body.type,body,()=>{
      if(body.type==='RIGHTS_REVOKED')getFilm(s,body.filmId).rights.available=false;
      if(body.type==='FORMAT_CHANGED')getFilm(s,body.filmId).formats=body.formats;
      if(body.type==='FORMAT_UNAVAILABLE') {
        const film=getFilm(s,body.filmId);const remaining=film.formats.filter(f=>f!==body.format);
        film.formats=remaining;
      }
      if(body.type==='FEE_CHANGED')getFilm(s,body.filmId).rights.feePence=body.feePence;
      if(body.type==='BUDGET_CHANGED')s.constraints.budgetPence=body.budgetPence;
      if(body.type==='SLOT_CHANGED') {const slot=s.slots.find(slot=>slot.id===body.slotId);if(!slot)throw new ApiError(404,'NOT_FOUND','Slot not found');Object.assign(slot,ScreeningSlotSchema.parse({...slot,...body,id:slot.id}));}
      if(body.type==='COHORT_UPDATED') {const {type,cohortId,...patch}=body;Object.assign(getCohort(s,cohortId),patch);}
    },body.type==='COHORT_UPDATED'));
  };
  app.post('/api/events',req=>handleEvent(req));
  app.post('/api/events/rights-revoked',req=>handleEvent(req,'RIGHTS_REVOKED'));
  app.post('/api/events/format-unavailable',req=>handleEvent(req,'FORMAT_UNAVAILABLE'));
  app.post('/api/events/budget-changed',req=>handleEvent(req,'BUDGET_CHANGED'));
  app.get('/api/events',async req=>(await data.read(sessionId(req))).events);
  app.get('/api/runs',async req=>(await data.read(sessionId(req))).runs);
  app.get('/api/programme-versions/:id/evidence',async req=>{const s=await data.read(sessionId(req));const version=findVersion(s,param(req,'id'));return s.evidence.find(e=>e.id===version.evidenceId);});
  app.get('/api/programme-versions/:id/diff/:otherVersion',async req=>{
    const s=await data.read(sessionId(req));const before=findVersion(s,param(req,'id'));const after=findVersion(s,param(req,'otherVersion'));
    return{beforeVersionId:before.id,afterVersionId:after.id,changes:before.items.map(item=>{const next=after.items.find(i=>i.slotId===item.slotId);return{slotId:item.slotId,before:item,after:next ?? null,changed:JSON.stringify(item)!==JSON.stringify(next)};}),objectiveDelta:after.objective-before.objective,costDelta:after.totalCost-before.totalCost,coverage:after.coverage.map(c=>({...c,delta:c.score-(before.coverage.find(p=>p.cohortId===c.cohortId)?.score??0)}))};
  });
  app.get('/api/programme-versions/:id/export',async(req,reply)=>{const s=await data.read(sessionId(req));const v=findVersion(s,param(req,'id'));if(v.status!=='APPROVED')throw new ApiError(409,'APPROVAL_REQUIRED','Only a currently approved programme can be exported');const violations=currentViolations(s,v);if(violations.length)throw new ApiError(409,'REVALIDATION_FAILED','Programme requires fresh approval',violations);reply.header('Content-Disposition',`attachment; filename="programme-${v.id}.json"`);return{cinema:s.cinema,programme:v,evidence:s.evidence.find(e=>e.id===v.evidenceId),notice:'Programme planning export only. Approval does not book films or clear real rights.'};});
  app.get('/api/programme-versions/:id/rights-enquiry',async(req,reply)=>{const s=await data.read(sessionId(req));const v=findVersion(s,param(req,'id'));if(v.status!=='APPROVED')throw new ApiError(409,'APPROVAL_REQUIRED','Approve the programme before preparing a rights enquiry');reply.type('text/plain').header('Content-Disposition',`attachment; filename="rights-enquiry-${v.id}.txt"`);return rightsEnquiryText(s,v);});
  app.post('/api/qloo/resolve',async req=>{
    const body=z.object({filmId:idSchema.optional(),query:z.string().min(1).max(300).optional(),type:z.string().optional()}).strict().parse(req.body);
    const s=await data.read(sessionId(req));const film=body.filmId?getFilm(s,body.filmId):undefined;
    if(!film&&!body.query)throw new ApiError(400,'QUERY_REQUIRED','Provide a filmId or search query');
    const result=await qloo().search(body.query ?? film!.title,{take:10,type:body.type ?? 'urn:entity:movie'});
    return{filmId:film?.id,candidates:result.entities,evidence:result.evidence,warnings:result.warnings,requiresConfirmation:true};
  });
  app.post('/api/qloo/confirm',async req=>{
    const body=z.object({filmId:idSchema,entityId:z.string().uuid()}).strict().parse(req.body);
    const resolved=await qloo().entities([body.entityId]);
    if(resolved.status!=='complete'||resolved.evidence.cache==='STALE_CACHE')throw new ApiError(422,'MAPPING_UNVERIFIED','Complete fresh entity evidence is required to confirm a film mapping');
    const entity=resolved.entities.find(e=>e.entityId===body.entityId.toLowerCase());if(!entity)throw new ApiError(422,'ENTITY_NOT_FOUND','Selected Qloo entity was not returned');
    if(entity.type!=='urn:entity:movie')throw new ApiError(422,'ENTITY_TYPE_MISMATCH','A film mapping must reference a verified Qloo movie entity');
    return data.update(sessionId(req),s=>{const film=getFilm(s,body.filmId);if(s.films.some(f=>f.id!==film.id&&f.qlooEntityId===entity.entityId))throw new ApiError(409,'DUPLICATE_MAPPING','This Qloo movie is already mapped to another catalogue film');return applyChange(s,'MAPPING_CONFIRMED',{filmId:film.id,entityId:entity.entityId},()=>{film.qlooEntityId=entity.entityId;film.mappingStatus='CONFIRMED';s.mappings[film.id]={entityId:entity.entityId,title:entity.name,confirmedAt:now()};},true);});
  });
  const profile=async(req:FastifyRequest,reply:import('fastify').FastifyReply)=>{
    const body=z.object({cohortId:idSchema.optional()}).strict().parse(req.body ?? {});
    const result=await data.update(sessionId(req),async s=>{
      if(body.cohortId)getCohort(s,body.cohortId);
      // All cohorts use the same fixed catalogue; a profile refresh never silently supports old approval.
      try {
        const evidence=await collectAffinities(s,'QLOO');
        const changed=s.evidenceMode!=='QLOO'||JSON.stringify(s.affinities)!==JSON.stringify(evidence.affinities);
        if(changed)s.revision++;
        const snapshot=recordEvidence(s,'QLOO',evidence);
        if(changed) {
          const event:ProgrammeEvent={id:randomUUID(),createdAt:now(),type:'CULTURAL_EVIDENCE_UPDATED',payload:{evidenceId:snapshot.id},invalidatedVersionIds:[]};
          for(const version of s.versions.filter(v=>v.status==='APPROVED')) {
            version.status='INVALIDATED';version.invalidatedAt=now();version.invalidationReason='Cultural evidence changed. Generate and review a new draft.';event.invalidatedVersionIds.push(version.id);
          }
          s.events.push(event);
        }
        s.affinities=evidence.affinities;s.evidenceMode='QLOO';s.providerStatus.qlooStatus='VERIFIED_COMPLETE_RESPONSE';return{state:s};
      } catch(error) {
        const message=error instanceof Error?error.message:'Qloo profile failed';
        const snapshot=error instanceof EvidenceCollectionError?recordEvidence(s,'QLOO',error.evidence,error.evidence.providerResponses.length?'PARTIAL':'FAILED',message):undefined;
        s.events.push({id:randomUUID(),createdAt:now(),type:'QLOO_PROFILE_FAILED',payload:{error:message,evidenceId:snapshot?.id},invalidatedVersionIds:[]});s.providerStatus.qlooStatus='BLOCKED_OR_INCOMPLETE';
        return{state:s,error:message};
      }
    });
    if(result.error)return reply.status(result.error.includes('NOT_CONFIGURED')?503:422).send({error:'QLOO_PROFILE_BLOCKED',message:result.error,state:result.state});return result.state;
  };
  app.post('/api/qloo/profile-cohort',profile);app.post('/api/qloo/profile-all',profile);
  app.get('/api/evidence/:id',async req=>{const s=await data.read(sessionId(req));const evidence=s.evidence.find(e=>e.id===param(req,'id'));if(!evidence)throw new ApiError(404,'NOT_FOUND','Evidence not found');return evidence;});
  app.get('/api/evaluations',async req=>(await data.read(sessionId(req))).evaluations);
  app.post('/api/evaluations',async req=>data.update(sessionId(req),async s=>{
    const evaluation:AppState['evaluations'][number]={id:randomUUID(),createdAt:now(),rows:[],warning:'These are separate evidence-source ablations, not proof that one source predicts attendance. Compare objective scores only when candidate universes match.'};
    for(const mode of ['DEMO','METADATA','QLOO','LLM_ONLY'] as EvidenceMode[]) {
      if((mode==='QLOO'&&!process.env.QLOO_API_KEY)||(mode==='LLM_ONLY'&&(!process.env.LLM_API_KEY||!process.env.LLM_MODEL))) {evaluation.rows.push({mode,status:'UNAVAILABLE',reason:`${mode} is not configured; no fabricated evaluation.`});continue;}
      const trial=clone(s);const result=await generateProgramme(trial,mode,{trigger:'EVALUATE'});
      s.runs.push(result.run);
      const captured=trial.evidence.filter(e=>!s.evidence.some(existing=>existing.id===e.id));s.evidence.push(...captured);
      const evidence=trial.evidence.find(e=>e.id===result.run.evidenceId);
      if(result.version)evaluation.rows.push({mode,status:'SUCCEEDED',objective:result.version.objective,totalCost:result.version.totalCost,selectedFilmIds:result.version.items.map(i=>i.filmId),candidateFilmIds:evidence?.candidateFilmIds,candidateCount:evidence?.candidateFilmIds.length,evidenceId:evidence?.id});
      else evaluation.rows.push({mode,status:'FAILED',reason:result.error});
    }
    s.evaluations.push(evaluation);return s;
  }));
  registerMcpRoutes(app,tasteSource);
  registerAgentRoutes(app,{ctxFor:sid=>({sessionId:sid,store:data,taste:tasteSource}),sessionOf:sessionId,generate:options.agentGenerate,config:options.agentConfig});
  if(webRoot)registerWebHost(app,webRoot);
  return app;
}
