import { describe, expect, it } from 'vitest';
import fixtures from '../packages/qloo/fixtures/synthetic-contract.json';
import { QlooClient, QlooError, INSIGHTS_PARAMETER_ALLOWLIST, normalizeFixedUniverse, parseQlooEntities, resolveFilmMapping } from '@rr/qloo';
import { runProbe } from '../scripts/qloo-probe';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const body = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
const make = (fetchImpl: typeof fetch, options = {}) => new QlooClient({ transport: 'direct-http', apiKey: 'SYNTHETIC_TEST_KEY_DO_NOT_USE', fetchImpl, sleep: async () => {}, ...options });
const request = { seedEntityIds: [id(9)], candidateEntityIds: [id(1), id(2)] };

describe('Qloo adapter using synthetic contract fixtures (NOT live responses)', () => {
  it('labels all test payloads as synthetic', () => expect(fixtures.fixtureLabel).toContain('NOT recorded'));
  it('makes no request without a configured key', async () => {
    let count = 0; const client = new QlooClient({ transport: 'direct-http', fetchImpl: async () => { count++; return body({}); } });
    await expect(client.search('example')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' }); expect(count).toBe(0);
  });
  it('GETs only allowed Insights parameters with server-only key header', async () => {
    const client = make(async (input, init) => {
      const url = new URL(String(input)); expect(url.origin).toBe('https://hackathon.api.qloo.com');
      expect(url.pathname).toBe('/v2/insights'); expect([...url.searchParams.keys()].sort()).toEqual([...INSIGHTS_PARAMETER_ALLOWLIST].sort());
      expect(url.searchParams.get('filter.type')).toBe('urn:entity:movie'); expect(url.searchParams.get('take')).toBe('2');
      expect(url.toString()).not.toContain('SYNTHETIC_TEST_KEY'); expect(init?.method).toBe('GET'); expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get('X-Api-Key')).toBe('SYNTHETIC_TEST_KEY_DO_NOT_USE'); expect(init?.redirect).toBe('error');
      return body(fixtures.insights);
    });
    const result = await client.insights(request); expect(result.complete).toBe(true); expect(result.rows.map(r => r.percentile)).toEqual([1, 0]);
    expect(result.raw).toEqual(fixtures.insights); expect(result.evidence.responseHash).toHaveLength(64); expect(result.evidence.candidateUniverseHash).toHaveLength(64);
  });
  it('uses /search query/types and /entities entity_ids independently', async () => {
    const urls: URL[] = []; const client = make(async input => { urls.push(new URL(String(input))); return body(fixtures.search); });
    await client.search('Example Film', { type: 'urn:entity:movie' }); await client.entities([id(1)]);
    expect(urls[0]!.pathname).toBe('/search'); expect(urls[0]!.searchParams.get('types')).toBe('urn:entity:movie'); expect(urls[1]!.searchParams.get('entity_ids')).toBe(id(1));
  });
  it('rejects unknown options, too-small take, invalid IDs and duplicate universe entries', async () => {
    const client = make(async () => { throw new Error('must not call'); });
    await expect(client.insights({ ...request, take: 1 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(client.insights({ ...request, unsupported: true } as never)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(client.insights({ ...request, candidateEntityIds: [id(1), id(1)] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(client.entities(['invented-id'])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
  it('refuses arbitrary origins so the API key cannot be redirected or exfiltrated', () => {
    for (const baseUrl of ['https://api.qloo.com','https://staging.api.qloo.com','http://api.qloo.com','https://evil.example','https://api.qloo.com.evil.example','https://api.qloo.com/path','https://secret@api.qloo.com']) expect(() => make(fetch, { baseUrl })).toThrow(QlooError);
  });
  it('preserves missing explainability rather than fabricating reasons', async () => {
    const result = await make(async () => body(fixtures.insights)).insights(request);
    expect(result.rows.every(r => !Object.hasOwn(r, 'explainability'))).toBe(true); expect(result.warnings.join(' ')).toContain('none is inferred');
  });
  it('preserves optional per-entity and aggregate explainability verbatim', async () => {
    const result = await make(async () => body(fixtures.withExplainability)).insights({ ...request, candidateEntityIds: [id(1)] });
    expect(result.rows[0]!.explainability).toEqual(fixtures.withExplainability.results.entities[0]!.query.explainability);
    expect(result.aggregateExplainability).toEqual(fixtures.withExplainability.query.explainability);
  });
  it('does not convert missing/null/string affinities to zero', async () => {
    const raw = structuredClone(fixtures.insights) as any; raw.results.entities[0].affinity = null;
    const result = await make(async () => body(raw)).insights(request);
    expect(result.complete).toBe(false); expect(result.status).toBe('partial'); expect(result.rows.map(r => r.percentile)).toEqual([null, null]); expect(result.rows[0]!.rawAffinity).toBeNull();
  });
  it('rejects incomplete, duplicate and out-of-universe rows without re-ranking survivors', async () => {
    for (const list of [fixtures.insights.results.entities.slice(0,1), [...fixtures.insights.results.entities, fixtures.insights.results.entities[0]], [...fixtures.insights.results.entities, { ...fixtures.insights.results.entities[0], entity_id: id(3) }]]) {
      const result = await make(async () => body({ success:true, results:{entities:list} })).insights(request);
      expect(result.complete).toBe(false); expect(result.rows.every(r => r.percentile === null)).toBe(true);
    }
  });
  it('reports unrecognized envelope and success:false as unknown, retaining raw', async () => {
    for (const raw of [{success:true,data:[]},{success:false,results:{entities:[]}}]) {
      const result = await make(async () => body(raw)).insights(request); expect(result.status).toBe('unknown'); expect(result.complete).toBe(false); expect(result.raw).toEqual(raw);
    }
  });
  it('treats malformed row as incomplete and never silently drops it as successful', () => {
    expect(parseQlooEntities({success:true,results:[null]}, '/search').status).toBe('partial');
  });
  it('uses tied midranks over the exact fixed universe independent of response order', () => {
    const entities = [{entityId:id(1),rawAffinity:0.2},{entityId:id(2),rawAffinity:0.2},{entityId:id(3),rawAffinity:0.9}];
    expect(normalizeFixedUniverse(entities.reverse(),[id(1),id(2),id(3)]).rows.map(r=>r.percentile)).toEqual([0.25,0.25,1]);
  });
  it('fails with retry metadata rather than retrying before a long Retry-After', async () => {
    let calls=0; const sleeps:number[]=[]; const client=make(async()=>{calls++;return body({secret:'untrusted error'},429,{'retry-after':'999999'});},{sleep:async(ms:number)=>{sleeps.push(ms);}});
    await expect(client.insights(request)).rejects.toMatchObject({code:'RATE_LIMITED',metadata:{retryAfterMs:999999000,retryBudgetExceeded:true,attempts:1,transport:'direct-http'}});expect(calls).toBe(1);expect(sleeps).toEqual([]);
  });
  it('never retries authentication errors or includes provider bodies/secrets in errors', async () => {
    let calls=0; const client=make(async()=>{calls++;return body({message:'SYNTHETIC_TEST_KEY_DO_NOT_USE'},401);});
    try { await client.insights(request); throw new Error('expected failure'); } catch(error) { expect(error).toMatchObject({code:'UNAUTHORIZED'});expect(String(error)).not.toContain('SYNTHETIC_TEST_KEY'); }
    expect(calls).toBe(1); expect(JSON.stringify(client)).not.toContain('SYNTHETIC_TEST_KEY');
  });
  it('strips thrown network error details', async () => {
    await expect(make(async()=>{throw new Error('SYNTHETIC_TEST_KEY_DO_NOT_USE');},{maxAttempts:1}).insights(request)).rejects.toMatchObject({code:'NETWORK',message:'Qloo network request failed'});
  });
  it('bounds even a fetch implementation that ignores abort', async () => {
    await expect(make(async()=>new Promise<Response>(()=>{}),{maxAttempts:1,timeoutMs:5}).insights(request)).rejects.toMatchObject({code:'TIMEOUT'});
  });
  it('distinguishes fresh and stale cache with original timestamp and identical evidence hash', async () => {
    let now=1000,calls=0;const client=make(async()=>{calls++;if(calls>1)throw new Error('offline');return body(fixtures.insights);},{now:()=>now,cacheTtlMs:100,staleMaxAgeMs:1000,maxAttempts:1});
    const live=await client.insights(request);now=1050;const fresh=await client.insights(request);now=1200;const stale=await client.insights(request);
    expect(calls).toBe(2);expect(live.evidence.cache).toBe('LIVE');expect(fresh.evidence.cache).toBe('FRESH_CACHE');expect(stale.evidence.cache).toBe('STALE_CACHE');
    expect(stale.evidence.fetchedAt).toBe(live.evidence.fetchedAt);expect(stale.evidence.responseHash).toBe(live.evidence.responseHash);expect(stale.evidence.servedAt).not.toBe(live.evidence.servedAt);
  });
  it('expires stale cache instead of presenting indefinite historical evidence', async () => {
    let now=0,calls=0;const client=make(async()=>{if(calls++)throw new Error('offline');return body(fixtures.insights);},{now:()=>now,cacheTtlMs:10,staleMaxAgeMs:20,maxAttempts:1});
    await client.insights(request);now=100;await expect(client.insights(request)).rejects.toMatchObject({code:'NETWORK'});
  });
  it('does not silently choose an ambiguous film or a yearless match', () => {
    const one=parseQlooEntities(fixtures.search,'/search').entities;
    expect(resolveFilmMapping('Example Film',2021,one).status).toBe('mapped');
    expect(resolveFilmMapping('Example Film',2021,[...one,{...one[0]!,entityId:id(2)}]).status).toBe('ambiguous');
    expect(resolveFilmMapping('Example Film',2021,[{...one[0]!,releaseYear:null}]).entityId).toBeNull();
  });
  it('no-key probe covers exactly 30 films and three cohorts but leaves gates unverified', async () => {
    let calls=0;const report=await runProbe(new QlooClient({transport:'direct-http',fetchImpl:async()=>{calls++;return body({});}}));
    expect(report.status).toBe('UNVERIFIED');expect(report.expectedFilms).toBe(30);expect(report.expectedCohorts).toBe(3);expect(report.mappedFilmCount).toBeNull();expect(report.gates.atLeast25Mapped).toBeNull();expect(calls).toBe(0);expect(report.evidence).toEqual([]);
  });
});
