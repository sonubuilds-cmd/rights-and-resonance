import { describe, expect, it } from 'vitest';
import { createDemoData, DemoDataSchema, FilmSchema, type Film, type ProgrammeItem } from '@rr/domain';
import { evaluateProgramme, filmEligibility, rankNormalizeAffinities, solveProgramme, validateProgramme, type SolveInput, type SolveSuccess } from '../src/index';

function small(count=5,slotCount=2):SolveInput {
  const demo=createDemoData();
  const films:Film[]=Array.from({length:count},(_,i)=>({...structuredClone(demo.films[0]!),id:String.fromCharCode(97+i),title:`Film ${i}`,genres:['Drama'],country:'GB',runtimeMinutes:90,rights:{...demo.films[0]!.rights,feePence:1000}}));
  const cohorts=demo.cohorts.slice(0,2);
  return {films,cohorts,slots:demo.slots.slice(0,slotCount),constraints:{territory:'GB',budgetPence:slotCount*1000},affinities:Object.fromEntries(cohorts.map(c=>[c.id,Object.fromEntries(films.map(f=>[f.id,0.5]))]))};
}
function optimal(input:SolveInput):SolveSuccess {
  const result=solveProgramme(input);expect(result.status).toBe('OPTIMAL');
  if(result.status!=='OPTIMAL')throw new Error(result.reason);return result;
}

describe('fixture integrity and input validation',()=>{
  it('contains exactly 30 films, 3 cross-domain cohorts and 4 slots, all demonstrably synthetic',()=>{
    const fixture=createDemoData();expect(DemoDataSchema.safeParse(fixture).success).toBe(true);
    expect([fixture.films.length,fixture.cohorts.length,fixture.slots.length]).toEqual([30,3,4]);
    expect(fixture.films.every(f=>f.rights.source==='SYNTHETIC'&&f.qlooEntityId===null&&f.mappingStatus==='UNMAPPED')).toBe(true);
    expect(fixture.cohorts.every(c=>new Set(c.seeds.map(s=>s.domain)).size>=2)).toBe(true);
    expect(fixture.notice).toContain('synthetic');
    fixture.films[0]!.rights.available=false;expect(createDemoData().films[0]!.rights.available).toBe(true);
  });
  it('validates integer pence, positive runtime, dates and search bounds',()=>{
    const input=small();expect(FilmSchema.safeParse({...input.films[0],runtimeMinutes:0}).success).toBe(false);
    input.constraints.budgetPence=1000.5;expect(solveProgramme(input).status).toBe('INVALID_INPUT');
    input.constraints.budgetPence=Number.MAX_SAFE_INTEGER+1;expect(solveProgramme(input).status).toBe('INVALID_INPUT');
    const tooMany=small(31);expect(solveProgramme(tooMany).status).toBe('INVALID_INPUT');
    const badDate=small();badDate.slots[0]!.endAt=badDate.slots[0]!.startAt;expect(solveProgramme(badDate).status).toBe('INVALID_INPUT');
  });
  it('rejects overlapping slots and duplicate identifiers',()=>{
    const input=small();input.slots[1]!.startAt=input.slots[0]!.startAt;
    expect(solveProgramme(input)).toMatchObject({status:'INVALID_INPUT',reason:expect.stringContaining('overlap')});
    const dup=small();dup.films[1]!.id=dup.films[0]!.id;
    expect(solveProgramme(dup)).toMatchObject({status:'INVALID_INPUT',reason:expect.stringContaining('Duplicate film')});
  });
});

describe('hard feasibility constraints',()=>{
  it('generates a complete distinct four-film slate under the integer budget',()=>{
    const input=createDemoData(),result=optimal(input);
    expect(result.items).toHaveLength(4);expect(new Set(result.items.map(i=>i.filmId)).size).toBe(4);
    expect(result.totalCostPence).toBeLessThanOrEqual(input.constraints.budgetPence);
    expect(result.totalCostPence).toBe(result.items.reduce((sum,i)=>sum+i.feePence,0));
    expect(validateProgramme(input,result.items)).toEqual([]);
  });
  it('excludes unavailable and unknown rights, wrong territory, date, runtime and format',()=>{
    const input=small();const base=input.films[0]!,slot=input.slots[0]!;
    const variants:Film[]=[
      {...base,rights:{...base.rights,available:false}},
      {...base,rights:{...base.rights,available:null}},
      {...base,rights:{...base.rights,territory:'US'}},
      {...base,rights:{...base.rights,availableFrom:'2026-11-01T00:00:00Z'}},
      {...base,rights:{...base.rights,availableTo:'2026-10-16T17:30:00Z'}},
      {...base,runtimeMinutes:151},
      {...base,formats:['35MM']},
      {...base,formats:[]},
    ];
    for(const film of variants)expect(filmEligibility(film,slot,input.constraints).length).toBeGreaterThan(0);
    expect(filmEligibility({...base,runtimeMinutes:150},slot,input.constraints)).toEqual([]);
    input.films[0]!.rights.available=null;expect(optimal(input).items.some(i=>i.filmId==='a')).toBe(false);
  });
  it('returns explicit infeasibility rather than a partial slate when total budget is short by one penny',()=>{
    const input=small();input.constraints.budgetPence=1999;
    expect(solveProgramme(input)).toMatchObject({status:'INFEASIBLE'});
    input.constraints.budgetPence=2000;expect(optimal(input).totalCostPence).toBe(2000);
  });
  it('honours locks and rejects conflicting or ineligible locked assignments',()=>{
    const input=small();input.locks=[{slotId:input.slots[0]!.id,filmId:'e'}];
    expect(optimal(input).items[0]!.filmId).toBe('e');
    input.films[4]!.rights.available=false;expect(solveProgramme(input).status).toBe('INFEASIBLE');
    input.locks.push({slotId:input.slots[1]!.id,filmId:'e'});expect(solveProgramme(input).status).toBe('INVALID_INPUT');
  });
  it('revalidates current fees and rights rather than trusting an approved snapshot',()=>{
    const input=small(),result=optimal(input);input.films.find(f=>f.id===result.items[0]!.filmId)!.rights.feePence+=1;
    expect(validateProgramme(input,result.items).join(' ')).toMatch(/Fee changed/);
    input.films.find(f=>f.id===result.items[1]!.filmId)!.rights.available=false;
    expect(validateProgramme(input,result.items).join(' ')).toMatch(/Rights are unavailable/);
    const repeated:ProgrammeItem[]=[result.items[0]!,result.items[0]!];
    expect(validateProgramme(input,repeated).join(' ')).toMatch(/more than once/);
  });
});

describe('evidence normalization and fair objective',()=>{
  it('treats null/absent affinity as unknown, even on an operationally ineligible film',()=>{
    const input=small();input.films[4]!.rights.available=false;input.affinities[input.cohorts[0]!.id]!.e=null;
    const result=solveProgramme(input);expect(result.status).toBe('INCOMPLETE_EVIDENCE');
    expect(result.diagnostics.missingEvidence).toEqual([{cohortId:input.cohorts[0]!.id,filmId:'e'}]);
    const normalized=rankNormalizeAffinities(input.films,input.cohorts,input.affinities);
    expect(Object.values(normalized.matrix[input.cohorts[0]!.id]!).every(s=>s===null)).toBe(true);
    delete input.affinities[input.cohorts[0]!.id]!.e;expect(solveProgramme(input).status).toBe('INCOMPLETE_EVIDENCE');
  });
  it('preserves genuine zero scores and uses average ranks for ties on the fixed universe',()=>{
    const input=small(4),cohort=input.cohorts[0]!;input.affinities[cohort.id]={a:0,b:0,c:10,d:20};
    const first=rankNormalizeAffinities(input.films,input.cohorts,input.affinities);
    expect(first.missing).toEqual([]);expect(first.matrix[cohort.id]).toEqual({a:1/6,b:1/6,c:2/3,d:1});
    input.films[3]!.rights.available=false;
    expect(rankNormalizeAffinities(input.films,input.cohorts,input.affinities).matrix).toEqual(first.matrix);
    expect(Object.values(first.matrix[input.cohorts[1]!.id]!)).toEqual([0.5,0.5,0.5,0.5]);
  });
  it('maximizes worst-cohort top-two coverage before average coverage',()=>{
    const input=small();const [one,two]=input.cohorts;
    input.affinities[one!.id]={a:5,b:4,c:3,d:2,e:1};input.affinities[two!.id]={a:1,b:2,c:4,d:5,e:3};
    const result=optimal(input);expect(result.objective.minCoverage).toBe(0.5);
    expect(result.objective.averageCoverage).toBe(0.5625);expect(result.items.map(i=>i.filmId)).toEqual(['a','d']);
    const norm=rankNormalizeAffinities(input.films,input.cohorts,input.affinities).matrix;
    const unbalanced=evaluateProgramme([{slotId:'x',filmId:'c',feePence:1000},{slotId:'y',filmId:'d',feePence:1000}],input.films,input.cohorts,norm,2000);
    expect(unbalanced.objective.averageCoverage).toBeGreaterThan(result.objective.averageCoverage);
    expect(unbalanced.objective.minCoverage).toBeLessThan(result.objective.minCoverage);
  });
  it('breaks tied fairness by genre/country diversity, then cost savings, then stable IDs',()=>{
    const input=small();input.constraints.budgetPence=3000;
    input.films[3]!.genres=['Fantasy'];input.films[3]!.country='Japan';input.films[3]!.rights.feePence=800;
    input.films[4]!.genres=['Fantasy'];input.films[4]!.country='Japan';input.films[4]!.rights.feePence=900;
    const result=optimal(input);expect(result.items.map(i=>i.filmId)).toEqual(['a','d']);
    expect(result.objective.diversity).toBe(4);expect(result.objective.savingsPence).toBe(1200);
  });
  it('computes top-two coverage, not the mean of all four films or a popularity sum',()=>{
    const input=small(4,4);const norm=rankNormalizeAffinities(input.films,input.cohorts,{[input.cohorts[0]!.id]:{a:1,b:2,c:3,d:4},[input.cohorts[1]!.id]:{a:4,b:3,c:2,d:1}}).matrix;
    const items=input.slots.map((slot,i)=>({slotId:slot.id,filmId:input.films[i]!.id,feePence:1000}));
    const result=evaluateProgramme(items,input.films,input.cohorts,norm,4000);
    expect(result.coverage[0]!.score).toBeCloseTo(5/6);expect(result.coverage[0]!.topFilmIds).toEqual(['d','c']);
  });
  it('uses collision-free cache and tie keys for IDs containing delimiters',()=>{
    const input=small(6,4);const ids=['a','a|b','b|c','c','d','e'];
    const formats=['DCP','DCP','BLURAY','BLURAY','35MM','DIGITAL'] as const;
    input.films.forEach((film,i)=>{film.id=ids[i]!;film.formats=[formats[i]!];film.rights.feePence=(i===0||i===2)?10:1;});
    input.slots.forEach((slot,i)=>{slot.format=(['DCP','BLURAY','35MM','DIGITAL'] as const)[i]!;});
    input.affinities=Object.fromEntries(input.cohorts.map(c=>[c.id,Object.fromEntries(ids.map(id=>[id,1]))]));
    input.constraints.budgetPence=100;const result=optimal(input);
    expect(result.items.map(item=>item.filmId)).toEqual(['a|b','c','d','e']);expect(result.totalCostPence).toBe(4);
  });
  it('is deterministic regardless of catalogue, cohort, slot and object insertion order',()=>{
    const input=small();const one=optimal(input);
    input.films.reverse();input.cohorts.reverse();input.slots.reverse();const two=optimal(input);
    expect(two.items).toEqual(one.items);expect(two.objective).toEqual(one.objective);
  });
});

describe('repair policy',()=>{
  it('explicitly distinguishes minimal-change repair from global fairness reoptimization',()=>{
    const input=small(),[one,two]=input.cohorts;
    input.affinities[one!.id]={a:5,b:4,c:3,d:2,e:1};input.affinities[two!.id]={a:1,b:2,c:4,d:5,e:3};
    const previousItems=[{slotId:input.slots[0]!.id,filmId:'c',feePence:1000},{slotId:input.slots[1]!.id,filmId:'d',feePence:1000}];
    const minimal=optimal({...input,repair:{previousItems,policy:'MINIMAL_CHANGE'}});
    const global=optimal({...input,repair:{previousItems,policy:'GLOBAL_FAIRNESS'}});
    expect(minimal.items).toEqual(previousItems);expect(minimal.changes).toBe(0);
    expect(global.objective.minCoverage).toBeGreaterThan(minimal.objective.minCoverage);
    expect(global.changes).toBe(1);
    input.films[2]!.rights.available=false;
    const repaired=optimal({...input,repair:{previousItems,policy:'MINIMAL_CHANGE'}});
    expect(repaired.changes).toBe(1);expect(repaired.items[1]!.filmId).toBe('d');expect(validateProgramme(input,repaired.items)).toEqual([]);
  });
});

describe('seed-film handling (unknown for its own cohort only)',()=>{
  it('ranks the other films, skips the seed film in that cohort coverage and never zero-fills',()=>{
    const input=small(4,4);const [c0,c1]=[input.cohorts[0]!.id,input.cohorts[1]!.id];
    input.affinities={[c0]:{a:null,b:0.2,c:0.9,d:0.5},[c1]:{a:0.1,b:0.4,c:0.3,d:0.8}};
    expect(solveProgramme(input).status).toBe('INCOMPLETE_EVIDENCE');
    input.seedExcluded={[c0]:['a']};
    const norm=rankNormalizeAffinities(input.films,input.cohorts,input.affinities,input.seedExcluded);
    expect(norm.missing).toEqual([]);expect(norm.matrix[c0]).toEqual({a:null,b:0,c:1,d:0.5});
    const result=solveProgramme(input);expect(result.status).toBe('OPTIMAL');
    const cov=evaluateProgramme(input.slots.map((s,i)=>({slotId:s.id,filmId:input.films[i]!.id,feePence:input.films[i]!.rights.feePence})),input.films,input.cohorts,norm.matrix,1e9,input.seedExcluded);
    expect(cov.coverage[0]!.topFilmIds).not.toContain('a');
  });
  it('a null that is not a declared seed still blocks the solve',()=>{
    const input=small(4,4);const c0=input.cohorts[0]!.id;
    input.affinities={...input.affinities,[c0]:{a:0.1,b:null,c:0.9,d:0.5}};input.seedExcluded={[c0]:['a']};
    expect(solveProgramme(input).status).toBe('INCOMPLETE_EVIDENCE');
  });
});
