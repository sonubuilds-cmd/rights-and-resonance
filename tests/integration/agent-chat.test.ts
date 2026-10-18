import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeServer } from '../../apps/api/src/server.js';
import { MemoryStore } from '../../apps/api/src/store.js';
import { createInitialState } from '../../apps/api/src/state.js';
import { SyntheticTasteSource } from '../../apps/api/src/taste.js';
import { createGeminiGenerate, geminiFunctionDeclarations, GeminiError, loadAgentConfig, type AgentConfig, type GenerateFn, type GenerateRequest, type GenerateResponse, type GeminiContent } from '../../apps/api/src/agent-chat.js';

process.env.QLOO_PRECONFIRMED_MAPPINGS = 'off';
const SECRET = 'AIzaSy-TEST-SECRET-KEY-do-not-leak';
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map(c => c().catch(() => undefined))); });

type Any = Record<string, any>;
const model = (...parts: GeminiContent['parts']): GenerateResponse => ({ content: { role: 'model', parts }, finishReason: 'STOP' });
const call = (name: string, args: Any = {}, id = `c-${name}`, thoughtSignature?: string) => ({ functionCall: { id, name, args }, ...(thoughtSignature ? { thoughtSignature } : {}) });
const responsesIn = (req: GenerateRequest): Any[] => req.contents.flatMap(c => c.parts.filter(p => p.functionResponse).map(p => p.functionResponse!));

async function boot(generate: GenerateFn, config: Partial<AgentConfig> = {}) {
  const app = await makeServer({ store: new MemoryStore(() => createInitialState('memory')), taste: new SyntheticTasteSource(), agentGenerate: generate, agentConfig: { apiKey: SECRET, fake: false, ...config } });
  closers.push(() => app.close());
  let cookie = '';
  const send = async (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, payload: payload as any, headers: { ...(cookie ? { cookie } : {}), ...headers } });
    const set = res.headers['set-cookie']; const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : {}) as Any, raw: res.body };
  };
  const chat = (message: string) => send('POST', '/api/agent/chat', { message });
  const state = async () => (await send('GET', '/api/state')).body;
  return { app, send, chat, state };
}

describe('Gemini REST transport', () => {
  it('sends the key only as a header, uses parametersJsonSchema without $schema, and maps responses', async () => {
    const fetchImpl = vi.fn(async (_url: any, _init: any) => new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'hi', thoughtSignature: 'sig' }] }, finishReason: 'STOP' }] }), { status: 200 }));
    const gen = createGeminiGenerate(SECRET, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await gen({ model: 'gemini-2.5-flash', systemInstruction: 'sys', contents: [{ role: 'user', parts: [{ text: 'x' }] }], functionDeclarations: geminiFunctionDeclarations() });
    expect(out.content?.parts[0]).toMatchObject({ text: 'hi', thoughtSignature: 'sig' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(String(url)).not.toContain(SECRET);
    expect(init.headers['x-goog-api-key']).toBe(SECRET);
    expect(init.body).not.toContain(SECRET);
    expect(init.body).not.toContain('$schema');
    expect(init.body).not.toContain('userConfirmed');
    expect(JSON.parse(init.body).tools[0].functionDeclarations).toHaveLength(10);
  });
  it.each([[429, 'rate_limit'], [403, 'auth'], [404, 'model_not_found'], [503, 'unavailable'], [400, 'bad_request']])('maps HTTP %i to %s without echoing the key', async (status, kind) => {
    const gen = createGeminiGenerate(SECRET, { fetchImpl: (async () => new Response(`error mentioning ${SECRET}`, { status })) as unknown as typeof fetch });
    const err = await gen({ model: 'm', systemInstruction: '', contents: [], functionDeclarations: [] }).catch(e => e);
    expect(err).toBeInstanceOf(GeminiError); expect(err.kind).toBe(kind); expect(err.message).not.toContain(SECRET);
  });
  it('reports a safety block and network failures', async () => {
    const blocked = createGeminiGenerate(SECRET, { fetchImpl: (async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 })) as unknown as typeof fetch });
    expect(await blocked({ model: 'm', systemInstruction: '', contents: [], functionDeclarations: [] })).toMatchObject({ blockReason: 'SAFETY' });
    const down = createGeminiGenerate(SECRET, { fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    await expect(down({ model: 'm', systemInstruction: '', contents: [], functionDeclarations: [] })).rejects.toMatchObject({ kind: 'unavailable' });
  });
  it('keeps the scripted model off in production and defaults the model', () => {
    expect(loadAgentConfig({ AGENT_FAKE_MODEL: 'scripted', NODE_ENV: 'production' } as any).fake).toBe(false);
    expect(loadAgentConfig({ AGENT_FAKE_MODEL: 'scripted' } as any).fake).toBe(true);
    expect(loadAgentConfig({} as any)).toMatchObject({ model: 'gemini-2.5-flash', perDay: 60, perMinute: 10, maxRounds: 8 });
    expect(loadAgentConfig({ AGENT_DAILY_LIMIT: '5', GEMINI_MODEL: 'x' } as any)).toMatchObject({ perDay: 5, model: 'x' });
  });
  it('declares schemas Gemini accepts and hides userConfirmed from the model', () => {
    const decls = geminiFunctionDeclarations();
    expect(decls.map(d => d.name)).toContain('approve_programme');
    const approve = decls.find(d => d.name === 'approve_programme')!;
    expect(JSON.stringify(approve)).not.toContain('userConfirmed');
    expect(approve.parametersJsonSchema).toMatchObject({ required: ['versionId'] });
    for (const d of decls) expect(JSON.stringify(d.parametersJsonSchema)).not.toMatch(/\$schema|"const"|additionalProperties/);
  });
});

describe('agent availability', () => {
  it('is unavailable without a key and refuses chat politely', async () => {
    const app = await makeServer({ store: new MemoryStore(() => createInitialState('memory')), taste: new SyntheticTasteSource(), agentConfig: { apiKey: undefined, fake: false } });
    closers.push(() => app.close());
    const status = (await app.inject({ method: 'GET', url: '/api/agent/status' })).json();
    expect(status).toMatchObject({ available: false }); expect(status.reason).toMatch(/GEMINI_API_KEY/);
    const chat = await app.inject({ method: 'POST', url: '/api/agent/chat', payload: { message: 'hello' } });
    expect(chat.statusCode).toBe(503); expect(chat.json()).toMatchObject({ error: 'AGENT_UNAVAILABLE' });
  });
  it('reports available with the model, never the key', async () => {
    const { send } = await boot(async () => model({ text: 'x' }), { model: 'gemini-test' });
    const s = await send('GET', '/api/agent/status');
    expect(s.body).toMatchObject({ available: true, model: 'gemini-test' });
    expect(s.raw).not.toContain(SECRET);
  });
});

describe('agent tool loop over the shared registry', () => {
  it('runs multi-round tool calls against the session workspace and echoes model content incl. thought signatures', async () => {
    const seen: GenerateRequest[] = [];
    let round = 0;
    const gen: GenerateFn = async req => {
      seen.push(structuredClone({ ...req, signal: undefined }));
      round++;
      if (round === 1) return model(call('get_workspace', {}, 'a', 'SIG-1'), call('generate_programme', { mode: 'DEMO' }, 'b'));
      if (round === 2) {
        const gen = responsesIn(req).find(r => r.name === 'generate_programme')!;
        return model(call('explain_film', { filmId: gen.response.data.programme.films[0].filmId }, 'c'));
      }
      return model({ text: 'Here is the season and why each film earns its slot.' });
    };
    const { chat, state, send } = await boot(gen);
    const res = await chat('Plan our season');
    expect(res.status).toBe(200);
    expect(res.body.reply).toMatch(/season/);
    expect(res.body.rounds).toBe(3);
    expect(res.body.steps.map((s: Any) => s.tool)).toEqual(['get_workspace', 'generate_programme', 'explain_film']);
    expect(res.body.steps.every((s: Any) => s.ok)).toBe(true);
    expect(res.body.steps[1]).toMatchObject({ provenance: 'DEMO', mutated: true, args: { mode: 'DEMO' } });
    expect(res.body.steps[1].summary).toMatch(/Draft v1/);
    // same workspace the UI reads
    const s = await state();
    expect(s.versions).toHaveLength(1); expect(s.versions[0].status).toBe('DRAFT');
    // call/response matching and signature echo
    const second = seen[1]!;
    expect(second.contents[1]).toMatchObject({ role: 'model' });
    expect(second.contents[1]!.parts[0]).toMatchObject({ thoughtSignature: 'SIG-1' });
    const fr = second.contents[2]!.parts.map(p => p.functionResponse!);
    expect(fr.map(f => [f.id, f.name])).toEqual([['a', 'get_workspace'], ['b', 'generate_programme']]);
    expect(second.systemInstruction).toMatch(/NEVER|cannot approve/i);
    // transcript is server-held for page reloads
    const conv = await send('GET', '/api/agent/conversation');
    expect(conv.body.messages.map((m: Any) => m.role)).toEqual(['user', 'assistant']);
    expect(conv.body.messages[1].steps).toHaveLength(3);
    expect(res.raw).not.toContain(SECRET);
  });
  it('returns tool failures to the model instead of crashing', async () => {
    let n = 0;
    const gen: GenerateFn = async req => (++n === 1 ? model(call('explain_film', { filmId: 'nope' }, 'x')) : model({ text: `saw ${(responsesIn(req)[0]!.response as Any).error.code}` }));
    const { chat } = await boot(gen);
    const res = await chat('explain nope');
    expect(res.body.reply).toBe('saw NOT_FOUND');
    expect(res.body.steps[0]).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
  it('stops after the configured number of tool rounds and keeps history well-formed', async () => {
    const seen: number[] = [];
    const gen: GenerateFn = async req => { seen.push(req.contents.length); return model(call('get_workspace', {}, `w${seen.length}`)); };
    const { chat } = await boot(gen, { maxRounds: 3 });
    const res = await chat('loop forever');
    expect(res.status).toBe(200); expect(res.body.rounds).toBe(3); expect(res.body.reply).toMatch(/stopped after 3 rounds/i);
    expect(seen).toEqual([1, 3, 5]);
    const again = await chat('still there?');
    expect(again.status).toBe(200);
    expect(seen[3]).toBe(9); // 8 prior contents (incl. closing model turn) + the new user message
  });
});

describe('approval gate', () => {
  async function drafted() {
    let phase = 0; let versionId = ''; let calls = 0;
    const gen: GenerateFn = async req => {
      calls++;
      const r = responsesIn(req);
      if (phase === 0) { phase = 1; return model(call('generate_programme', { mode: 'DEMO' }, 'g')); }
      if (phase === 1) { versionId = r[0]!.response.data.programme.versionId; phase = 2; return model({ text: 'Draft ready.' }); }
      if (phase === 2) { phase = 3; return model(call('approve_programme', { versionId, userConfirmed: true }, 'ap')); } // model tries to approve, even claiming confirmation
      if (phase === 3) { phase = 4; return model({ text: `Please press Confirm approval. Tool said: ${(r.at(-1)!.response as Any).error.code}` }); }
      return model({ text: 'ok' });
    };
    const ctx = await boot(gen);
    await ctx.chat('plan');
    return { ...ctx, getVersionId: () => versionId, calls: () => calls };
  }
  it('a model-initiated approval returns APPROVAL_REQUIRED and does not approve', async () => {
    const { chat, state, getVersionId } = await drafted();
    const res = await chat('yes, approve it');
    expect(res.status).toBe(200);
    const step = res.body.steps[0];
    expect(step).toMatchObject({ tool: 'approve_programme', ok: false, code: 'APPROVAL_REQUIRED', requiresConfirmation: true });
    expect(step.args).not.toHaveProperty('userConfirmed');
    expect(res.body.pendingApproval).toMatchObject({ versionId: getVersionId() });
    expect(res.body.reply).toMatch(/APPROVAL_REQUIRED/);
    expect((await state()).versions[0].status).toBe('DRAFT');
  });
  it('confirmApproval from the UI approves exactly the pending version, without the model', async () => {
    const { chat, state, send, getVersionId, calls } = await drafted();
    await chat('approve it');
    const before = calls();
    const wrong = await send('POST', '/api/agent/chat', { confirmApproval: 'some-other-id' });
    expect(wrong.status).toBe(409); expect(wrong.body.error).toBe('APPROVAL_NOT_PENDING');
    expect((await state()).versions[0].status).toBe('DRAFT');
    const ok = await send('POST', '/api/agent/chat', { confirmApproval: getVersionId() });
    expect(ok.status).toBe(200);
    expect(ok.body.steps[0]).toMatchObject({ tool: 'approve_programme', ok: true, confirmedByUser: true });
    expect(ok.body.pendingApproval).toBeNull();
    expect(ok.body.reply).toMatch(/^Approved v1/);
    expect((await state()).versions[0].status).toBe('APPROVED');
    expect(calls()).toBe(before);
    const replay = await send('POST', '/api/agent/chat', { confirmApproval: getVersionId() });
    expect(replay.status).toBe(409);
  });
  it('rejects confirmApproval when nothing is pending and requires exactly one of message/confirmApproval', async () => {
    const { send } = await boot(async () => model({ text: 'x' }));
    expect((await send('POST', '/api/agent/chat', { confirmApproval: 'abc' })).status).toBe(409);
    expect((await send('POST', '/api/agent/chat', { message: 'a', confirmApproval: 'abc' })).status).toBe(400);
    expect((await send('POST', '/api/agent/chat', {})).status).toBe(400);
  });
  it('a new message withdraws a stale approval request', async () => {
    const { chat, send, getVersionId } = await drafted();
    await chat('approve it');
    await chat('actually, wait');
    expect((await send('POST', '/api/agent/chat', { confirmApproval: getVersionId() })).status).toBe(409);
  });
  it('cannot approve unknown or non-draft versions', async () => {
    let n = 0;
    const gen: GenerateFn = async () => (++n === 1 ? model(call('approve_programme', { versionId: 'ghost' }, 'z')) : model({ text: 'done' }));
    const { chat } = await boot(gen);
    const res = await chat('approve ghost');
    expect(res.body.steps[0]).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(res.body.pendingApproval).toBeNull();
  });
});

describe('limits and error surfacing', () => {
  it('enforces the per-minute and daily message limits per session', async () => {
    const { chat, send } = await boot(async () => model({ text: 'ok' }), { perMinute: 2, perDay: 100 });
    expect((await chat('1')).status).toBe(200); expect((await chat('2')).status).toBe(200);
    const limited = await chat('3');
    expect(limited.status).toBe(429); expect(limited.body.error).toBe('AGENT_RATE_LIMITED'); expect(limited.body.retryAfterSeconds).toBeGreaterThan(0);
    // a different browser session is unaffected
    const other = await boot(async () => model({ text: 'ok' }), { perMinute: 1 });
    expect((await other.chat('x')).status).toBe(200);
    void send;
    const daily = await boot(async () => model({ text: 'ok' }), { perDay: 1 });
    await daily.chat('a');
    const d = await daily.chat('b');
    expect(d.status).toBe(429); expect(d.body.error).toBe('AGENT_DAILY_LIMIT'); expect(d.body.message).toMatch(/MCP/);
  });
  it('limits message length and rejects blank messages', async () => {
    const { chat } = await boot(async () => model({ text: 'ok' }), { maxMessageChars: 20 });
    expect((await chat('x'.repeat(21))).status).toBe(413);
    expect((await chat('   ')).status).toBe(400);
  });
  it('bounds model-facing history at turn boundaries', async () => {
    const lengths: number[] = []; const firstRoles: string[] = [];
    const gen: GenerateFn = async req => { lengths.push(req.contents.length); firstRoles.push(req.contents[0]!.role + ':' + (req.contents[0]!.parts[0]!.text ? 'text' : 'other')); return model({ text: 'ok' }); };
    const { chat } = await boot(gen, { maxHistoryContents: 6, perMinute: 100, perDay: 1000 });
    for (let i = 0; i < 12; i++) await chat(`message ${i}`);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(7);
    expect(new Set(firstRoles)).toEqual(new Set(['user:text']));
  });
  it('surfaces Gemini quota (429) cleanly and recovers on the next message', async () => {
    let n = 0; const lengths: number[] = [];
    const gen: GenerateFn = async req => { lengths.push(req.contents.length); if (++n === 1) throw new GeminiError('rate_limit', 'x', 429); return model({ text: 'back' }); };
    const { chat } = await boot(gen);
    const bad = await chat('hi');
    expect(bad.status).toBe(429); expect(bad.body.error).toBe('GEMINI_RATE_LIMIT'); expect(bad.body.message).toMatch(/quota/i);
    expect(JSON.stringify(bad.body)).not.toContain(SECRET);
    const good = await chat('hi again');
    expect(good.body.reply).toBe('back'); expect(lengths).toEqual([1, 1]); // failed turn rolled back out of the history
  });
  it('surfaces safety blocks, empty candidates and unexpected failures', async () => {
    const blocked = await boot(async () => ({ blockReason: 'SAFETY' }));
    const b = await blocked.chat('x'); expect(b.status).toBe(422); expect(b.body.message).toMatch(/safety/i);
    const finishBlocked = await boot(async () => ({ content: { role: 'model', parts: [] }, finishReason: 'SAFETY' }));
    expect((await finishBlocked.chat('x')).status).toBe(422);
    const empty = await boot(async () => ({}));
    const e = await empty.chat('x'); expect(e.status).toBe(502); expect(e.body.error).toBe('GEMINI_EMPTY');
    const boom = await boot(async () => { throw new Error(`socket exploded with ${SECRET}`); });
    const o = await boom.chat('x'); expect(o.status).toBe(502); expect(o.raw).not.toContain(SECRET); expect(o.raw).not.toContain('exploded');
  });
  it('keeps partial tool progress visible when a later round fails', async () => {
    let n = 0;
    const gen: GenerateFn = async () => { if (++n === 1) return model(call('generate_programme', { mode: 'DEMO' }, 'g')); throw new GeminiError('unavailable', 'x', 503); };
    const { chat, state } = await boot(gen);
    const res = await chat('plan');
    expect(res.status).toBe(502);
    expect(res.body.steps.map((s: Any) => s.tool)).toEqual(['generate_programme']);
    expect((await state()).versions).toHaveLength(1);
  });
  it('allows one in-flight turn per session', async () => {
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const { app, send } = await boot(async () => { await gate; return model({ text: 'late' }); });
    await send('GET', '/api/agent/status');
    const first = send('POST', '/api/agent/chat', { message: 'one' });
    await new Promise(r => setTimeout(r, 30));
    const second = await send('POST', '/api/agent/chat', { message: 'two' });
    expect(second.status).toBe(409); expect(second.body.error).toBe('AGENT_BUSY');
    release(); expect((await first).status).toBe(200);
    void app;
  });
  it('streams NDJSON progress events for browsers', async () => {
    let n = 0;
    const gen: GenerateFn = async () => (++n === 1 ? model(call('get_workspace', {}, 'w')) : model({ text: 'done' }));
    const { app } = await boot(gen);
    const res = await app.inject({ method: 'POST', url: '/api/agent/chat', payload: { message: 'hi' }, headers: { accept: 'application/x-ndjson' } });
    const events = res.body.trim().split('\n').map(l => JSON.parse(l));
    expect(events.map((e: Any) => e.type)).toEqual(['thinking', 'step_start', 'step', 'thinking', 'done']);
    expect(events[1]).toMatchObject({ tool: 'get_workspace' });
    expect(events.at(-1).result.reply).toBe('done');
  });
  it('can start a fresh conversation without resetting limits', async () => {
    const lengths: number[] = [];
    const { chat, send } = await boot(async req => { lengths.push(req.contents.length); return model({ text: 'ok' }); }, { perMinute: 2 });
    await chat('a'); await send('DELETE', '/api/agent/conversation');
    expect((await send('GET', '/api/agent/conversation')).body.messages).toEqual([]);
    await chat('b');
    expect(lengths).toEqual([1, 1]);
    expect((await chat('c')).status).toBe(429);
  });
});

describe('scripted demo model (non-production only)', () => {
  it('drives the real tools end to end: plan, then approval needs the button', async () => {
    const { chat, send, state } = await boot(undefined as any, { fake: true, apiKey: undefined });
    const status = (await send('GET', '/api/agent/status')).body;
    expect(status).toMatchObject({ available: true, scripted: true, model: 'scripted-demo-model' });
    const plan = await chat('Plan our two-night season and explain each pick');
    expect(plan.body.steps.map((s: Any) => s.tool)).toEqual(['get_workspace', 'get_taste_dna', 'generate_programme', 'explain_film', 'explain_film']);
    expect(plan.body.reply).toMatch(/Aftersun|Akira/);
    const ask = await chat('Please approve the programme');
    expect(ask.body.pendingApproval).toBeTruthy();
    expect((await state()).versions.at(-1).status).toBe('DRAFT');
    const done = await send('POST', '/api/agent/chat', { confirmApproval: ask.body.pendingApproval.versionId });
    expect(done.body.steps[0].ok).toBe(true);
    expect((await state()).versions.at(-1).status).toBe('APPROVED');
    const rights = await chat('Rights to Her just fell through — fix the programme');
    expect(rights.body.steps.map((s: Any) => s.tool)).toContain('withdraw_rights');
    expect((await state()).films.find((f: Any) => f.id === 'her').rights.available).toBe(false);
  });
});
