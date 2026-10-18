import { randomUUID } from 'node:crypto';
import { generateProgramme, currentViolations } from './workflow.js';
import type { AppState, ProgrammeEvent, ProgrammeVersion } from './types.js';

/**
 * Shared state transitions. Both the REST routes (server.ts) and the agent tools (agent-tools.ts) call these,
 * so an agent can never do anything the human UI could not, and the invariants live in exactly one place.
 */
const now=()=>new Date().toISOString();
export class ApiError extends Error { constructor(readonly statusCode: number, readonly code: string, message: string, readonly details?: unknown) { super(message); } }
export function findVersion(s:AppState,id:string) {const value=s.versions.find(v=>v.id===id);if(!value)throw new ApiError(404,'NOT_FOUND','Programme version not found in this session');return value;}
export function getFilm(s:AppState,id:string) {const film=s.films.find(f=>f.id===id);if(!film)throw new ApiError(404,'NOT_FOUND','Film not found');return film;}
export function getCohort(s:AppState,id:string) {const cohort=s.cohorts.find(c=>c.id===id);if(!cohort)throw new ApiError(404,'NOT_FOUND','Cohort not found');return cohort;}
/** Commit event and invalidation even when repair is infeasible. No approved item is edited. */
export async function applyChange(state:AppState,type:string,payload:Record<string,unknown>,mutate:()=>void,forceEvidenceInvalidation=false) {
  const parent=[...state.versions].reverse().find(v=>v.status==='APPROVED') ?? state.versions.at(-1);
  mutate();state.revision++;
  const event:ProgrammeEvent={id:randomUUID(),createdAt:now(),type,payload,invalidatedVersionIds:[]};state.events.push(event);
  for(const version of state.versions.filter(v=>v.status==='APPROVED')) {
    const violations=currentViolations(state,version);
    if(forceEvidenceInvalidation || violations.length) {
      version.status='INVALIDATED';version.invalidatedAt=now();version.invalidationReason=forceEvidenceInvalidation ? `${type}: cohort or mapping evidence changed; human review required.` : violations.join('; ');
      event.invalidatedVersionIds.push(version.id);
    }
  }
  if(parent && (forceEvidenceInvalidation || currentViolations(state,parent).length>0)) {
    const repaired=await generateProgramme(state,parent.mode,{parent,trigger:'REPAIR',repairPolicy:'MINIMAL_CHANGE'});
    if(repaired.version)event.repairedVersionId=repaired.version.id;
    else event.repairError=repaired.error;
  }
  return state;
}


/** Human approval. Idempotent for an already-approved, still-valid version. `programmeId` is optionally cross-checked. */
export function approveVersion(s:AppState,versionId:string,programmeId?:string):AppState {
  const version=findVersion(s,versionId);if(programmeId&&version.programmeId!==programmeId)throw new ApiError(409,'PROGRAMME_MISMATCH','Version does not belong to this programme');
  if(version.status==='INVALIDATED'||version.status==='SUPERSEDED')throw new ApiError(409,'VERSION_NOT_APPROVABLE','Invalidated or superseded versions cannot be approved');
  const violations=currentViolations(s,version);if(violations.length)throw new ApiError(409,'REVALIDATION_FAILED','Current constraints no longer permit this programme',violations);
  if(version.status==='APPROVED')return s; // idempotent after latest-state operational validation
  if(version.inputRevision!==s.revision)throw new ApiError(409,'STALE_DRAFT','Inputs changed after this draft. Generate and review a current draft before approval.');
  for(const previous of s.versions.filter(v=>v.programmeId===version.programmeId&&v.status==='APPROVED'))previous.status='SUPERSEDED';
  version.status='APPROVED';version.approvedAt=now();
  s.events.push({id:randomUUID(),createdAt:now(),type:'HUMAN_APPROVAL',payload:{versionId:version.id,programmeId:version.programmeId},invalidatedVersionIds:[]});
  return s;
}
/** Synthetic rights withdrawal; invalidates affected approvals and attempts a minimal-change repair draft. */
export function revokeRights(s:AppState,filmId:string,reason?:string) {
  return applyChange(s,'RIGHTS_REVOKED',{type:'RIGHTS_REVOKED',filmId,...(reason?{reason}:{})},()=>{getFilm(s,filmId).rights.available=false;});
}

export function rightsEnquiryText(s:AppState,v:ProgrammeVersion):string {
  return `DRAFT RIGHTS ENQUIRY — NOT SENT\n\nPlease confirm availability, screening format and licence fees for ${s.cinema.name} in ${s.constraints.territory}:\n\n${v.items.map(i=>`${i.filmTitle} | ${i.startAt} | ${i.format} | illustrative fee GBP ${(i.feePence/100).toFixed(2)}`).join('\n')}\n\nAll demo rights and fees are synthetic. No booking or payment has been made. Please confirm real terms before any public screening.\n`;
}
