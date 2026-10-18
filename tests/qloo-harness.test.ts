/** Every provider payload in this file is SYNTHETIC. The official installed harness itself is real. */
import { afterEach, describe, expect, it } from 'vitest';
import { QlooClient, hashEvidence, parseRetryAfter, type HarnessRunner } from '@rr/qloo';
import { runHarness } from '../packages/qloo/src/harness';
import { executeHarness, harnessArguments } from '../packages/qloo/src/harness-runtime.mjs';
import fixtures from '../packages/qloo/fixtures/synthetic-contract.json';
const KEY = 'SYNTHETIC_HARNESS_CONTRACT_KEY_DO_NOT_USE';
const ORIGIN = 'https://hackathon.api.qloo.com';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = { seedEntityIds: [id(9)], candidateEntityIds: [id(1), id(2)] };
const saved = { key: process.env.QLOO_API_KEY, base: process.env.QLOO_BASE_URL, trust: process.env.QLOO_TRUSTED_BASE_URL };
function configure() { process.env.QLOO_API_KEY = KEY; process.env.QLOO_BASE_URL = ORIGIN; process.env.QLOO_TRUSTED_BASE_URL = ORIGIN; }
afterEach(() => { for (const [key,value] of Object.entries({ QLOO_API_KEY: saved.key, QLOO_BASE_URL: saved.base, QLOO_TRUSTED_BASE_URL: saved.trust })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const observed = (raw: unknown) => ({ ok: true as const, version: '0.1.26', command: 'insights', cliExitCode: 0, httpStatus: 200, retryAfter: null, text: JSON.stringify(raw) });

describe.sequential('official harness transport (real installed CLI, synthetic provider responses)', () => {
  it('defaults to official harness and inspects capabilities locally without credentials or network', async () => {
    const client = new QlooClient();
    expect(client.status()).toEqual({ configured:false, baseUrl:ORIGIN, transport:'harness' });
    const status = await client.readiness();
    expect(status.harness).toMatchObject({ package:'@qloo/qloo-harness', installedVersion:'0.1.26', status:'READY', capabilities:['api search','api entity','api insights'] });
    expect(status.ready).toBe(false); expect(status.liveVerification).toBe('UNVERIFIED');
    expect(await client.readiness()).toBe(status);
  }, 20_000);
  it('never silently selects direct HTTP or a production/staging origin', async () => {
    expect(() => new QlooClient({transport:'invalid'})).toThrow();
    for (const baseUrl of ['https://api.qloo.com','https://staging.api.qloo.com']) expect(() => new QlooClient({baseUrl})).toThrow();
    expect(() => new QlooClient({fetchImpl:fetch})).toThrow(/explicit direct-http/);
    let requests = 0;
    const client = new QlooClient({apiKey:KEY,harnessRunner:async()=>{requests++;return{ok:false,code:'MISSING'};}});
    await expect(client.search('Example')).rejects.toMatchObject({code:'HARNESS_UNAVAILABLE', metadata:{transport:'harness',baseUrl:ORIGIN,endpoint:'/search',attempts:1}});
    expect(requests).toBe(1);
  });
  it('official search CLI makes one exact request; observer retains full response rather than flattened CLI output', async () => {
    configure(); let calls=0;
    const url = new URL('/search',ORIGIN); url.searchParams.set('query','Example "Film"; $(echo injected)'); url.searchParams.set('take','2'); url.searchParams.set('types','urn:entity:movie');
    const output = await executeHarness({action:'request',url:String(url)},async(input,init)=>{
      calls++; const actual=new URL(String(input)); expect([...actual.searchParams.keys()].sort()).toEqual(['query','take','types']);
      expect(actual.searchParams.get('query')).toBe('Example "Film"; $(echo injected)');
      expect(actual.searchParams.get('types')).toBe('urn:entity:movie'); expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('X-Api-Key')).toBe(KEY); expect(String(input)).not.toContain(KEY);
      return new Response(JSON.stringify(fixtures.search),{status:200});
    });
    expect(calls).toBe(1); expect(output).toMatchObject({ok:true,version:'0.1.26',command:'search',httpStatus:200,cliExitCode:0});
    expect(output.ok && JSON.parse(output.text!)).toEqual(fixtures.search);
    expect(harnessArguments('/search',Object.fromEntries(url.searchParams)).join(' ')).not.toContain(KEY);
  }, 20_000);
  it('official entity CLI supports a fixed multi-ID lookup and retains its raw envelope', async()=>{
    configure(); let calls=0;const raw={success:true,results:fixtures.insights.results.entities};
    const output=await executeHarness({action:'request',url:`${ORIGIN}/entities?entity_ids=${id(1)},${id(2)}`},async(input)=>{calls++;expect(new URL(String(input)).searchParams.get('entity_ids')).toBe(`${id(1)},${id(2)}`);return new Response(JSON.stringify(raw));});
    expect(calls).toBe(1);expect(output.ok && JSON.parse(output.text!)).toEqual(raw);expect(output).toMatchObject({command:'entity',cliExitCode:0});
  });
  it('official insights CLI preserves all five allowlisted parameters and unmodified explanation provenance', async()=>{
    configure();let calls=0;
    const params={'filter.type':'urn:entity:movie','signal.interests.entities':id(9),'filter.results.entities':id(1),'feature.explainability':'true',take:'1'};
    const url=new URL('/v2/insights',ORIGIN);Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
    const output=await executeHarness({action:'request',url:String(url)},async(input)=>{calls++;expect(Object.fromEntries(new URL(String(input)).searchParams)).toEqual(params);return new Response(JSON.stringify(fixtures.withExplainability));});
    expect(calls).toBe(1);expect(output.ok && JSON.parse(output.text!)).toEqual(fixtures.withExplainability);expect(output).toMatchObject({command:'insights',cliExitCode:0});
  });
  it('official CLI HTTP error keeps status and full Retry-After while dropping secret-bearing provider messages', async()=>{
    configure();const output=await executeHarness({action:'request',url:`${ORIGIN}/search?query=Example&take=1`},async()=>new Response(JSON.stringify({message:'do not leak provider errors'}),{status:429,headers:{'Retry-After':'86400'}}));
    expect(output).toMatchObject({ok:true,httpStatus:429,retryAfter:'86400',text:''});expect(JSON.stringify(output)).not.toContain('do not leak');expect(JSON.stringify(output)).not.toContain(KEY);
  });
  it('blocks altered endpoint/header, output overflow, and provider key echoes',async()=>{
    configure(); let calls=0;
    const invalid=await executeHarness({action:'request',url:'https://api.qloo.com/search?query=Example&take=1'},async()=>{calls++;return new Response('{}');});
    expect(invalid).toEqual({ok:false,code:'CONTRACT'});expect(calls).toBe(0);
    const overflow=await executeHarness({action:'request',url:`${ORIGIN}/search?query=Example&take=1`},async()=>new Response('x'.repeat(4_000_001)));
    expect(overflow).toEqual({ok:false,code:'OUTPUT_LIMIT'});
    const echo=await executeHarness({action:'request',url:`${ORIGIN}/search?query=Example&take=1`},async()=>new Response(JSON.stringify({message:KEY}),{status:200}));
    expect(echo).toEqual({ok:false,code:'CONTRACT'});
  });
  it('preserves immutable transport/raw evidence and freezes nested cached provenance',async()=>{
    let calls=0;const client=new QlooClient({apiKey:KEY,harnessRunner:async()=>{calls++;return observed(fixtures.insights);}});
    const live=await client.insights(request);const cached=await client.insights(request);
    expect(calls).toBe(1);expect(live.evidence).toMatchObject({transport:'harness',harness:{package:'@qloo/qloo-harness',version:'0.1.26',route:'qloo api'}});
    expect(live.evidence.responseHash).toBe(hashEvidence(live.raw));expect(cached.evidence.cache).toBe('FRESH_CACHE');
    expect(Object.isFrozen(live.raw)).toBe(true);expect(Object.isFrozen(live.evidence.harness)).toBe(true);expect(Object.isFrozen(cached.evidence.harness)).toBe(true);
    expect(()=>{live.evidence.harness!.version='fake';}).toThrow();expect(cached.evidence.harness?.version).toBe('0.1.26');
  });
  it('fails immediately when harness Retry-After exceeds budget, preserving retry guidance',async()=>{
    let calls=0; const sleeps:number[]=[];
    const runner:HarnessRunner=async()=>{calls++;return{...observed({}),httpStatus:429,retryAfter:'3600',text:''};};
    const client=new QlooClient({apiKey:KEY,harnessRunner:runner,now:()=>0,sleep:async n=>{sleeps.push(n);}});
    await expect(client.search('Example')).rejects.toMatchObject({code:'RATE_LIMITED',httpStatus:429,metadata:{transport:'harness',retryAfterMs:3_600_000,retryAt:'1970-01-01T01:00:00.000Z',retryBudgetExceeded:true,attempts:1}});
    expect(calls).toBe(1);expect(sleeps).toEqual([]);
  });
  it('honors short Retry-After seconds and HTTP dates and bounds total retries',async()=>{
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:03 GMT',0)).toBe(3000);expect(parseRetryAfter('nonsense',0)).toBeUndefined();expect(parseRetryAfter('-1',0)).toBeUndefined();expect(parseRetryAfter(null,0)).toBeUndefined();
    let calls=0;const sleeps:number[]=[];
    const client=new QlooClient({apiKey:KEY,now:()=>0,sleep:async n=>{sleeps.push(n);},harnessRunner:async()=>{calls++;return{...observed({}),httpStatus:503,retryAfter:'2',text:''};}});
    await expect(client.search('Example')).rejects.toMatchObject({code:'UPSTREAM',metadata:{attempts:3,retryAfterMs:2000}});expect(calls).toBe(3);expect(sleeps).toEqual([2000,2000]);
  });
  it('honors HTTP-date headers and stops when cumulative wait budget cannot honor another delay',async()=>{
    let calls=0;const sleeps:number[]=[];
    const client=new QlooClient({apiKey:KEY,now:()=>0,retryBudgetMs:5000,sleep:async n=>{sleeps.push(n);},harnessRunner:async()=>{calls++;return{...observed({}),httpStatus:429,retryAfter:'Thu, 01 Jan 1970 00:00:03 GMT',text:''};}});
    await expect(client.search('Example')).rejects.toMatchObject({code:'RATE_LIMITED',metadata:{attempts:2,retryAfterMs:3000,retryBudgetExceeded:true}});expect(calls).toBe(2);expect(sleeps).toEqual([3000]);
  });
  it('keeps no-key feasibility unverified while checking real local harness capabilities',async()=>{
    const {runProbe}=await import('../scripts/qloo-probe');
    const report=await runProbe(new QlooClient());
    expect(report).toMatchObject({schemaVersion:2,status:'UNVERIFIED',mappedFilmCount:null,provider:{transport:'harness'},readiness:{configured:false,liveVerification:'UNVERIFIED',harness:{status:'READY'}}});
    expect(report.evidence).toEqual([]);expect(report.profiles).toEqual([]);expect(Object.values(report.gates)).toEqual([null,null,null,null]);
  },20_000);
  it('kills the real isolated capability worker at its execution deadline',async()=>{
    await expect(runHarness({action:'capabilities'},{timeoutMs:1})).resolves.toEqual({ok:false,code:'TIMEOUT'});
  });
  it('bounds a hanging custom runner and never records thrown secret details',async()=>{
    const client=new QlooClient({apiKey:KEY,timeoutMs:5,maxAttempts:1,harnessRunner:async()=>new Promise(()=>{})});
    await expect(client.search('Example')).rejects.toMatchObject({code:'TIMEOUT',metadata:{transport:'harness'}});
    const failing=new QlooClient({apiKey:KEY,maxAttempts:1,harnessRunner:async()=>{throw new Error(KEY);}});
    await expect(failing.search('Example')).rejects.toMatchObject({code:'NETWORK',message:'Qloo network request failed'});
  });
});
