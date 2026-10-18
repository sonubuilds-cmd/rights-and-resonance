import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { makeServer } from '../../apps/api/src/server.js';
import { MemoryStore } from '../../apps/api/src/store.js';
import { createInitialState } from '../../apps/api/src/state.js';
import { SyntheticTasteSource } from '../../apps/api/src/taste.js';
import { agentTools, invokeAgentTool, toolDeclarations, toolInputJsonSchema } from '../../apps/api/src/agent-tools.js';
import { createAgentMcpServer } from '../../apps/api/src/mcp-server.js';
import { McpSessionManager } from '../../apps/api/src/mcp-http.js';

process.env.QLOO_PRECONFIRMED_MAPPINGS = 'off';
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map(c => c().catch(() => undefined))); });

type Data = Record<string, any>;
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = await c.callTool({ name, arguments: args });
  return { isError: Boolean(r.isError), data: (r.structuredContent ?? {}) as Data, text: (r.content as Array<{ text: string }>)[0]!.text };
};

async function inMemoryClient() {
  const server = createAgentMcpServer({ sessionId: 'unit', store: new MemoryStore(() => createInitialState('memory')), taste: new SyntheticTasteSource() });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(() => client.close());
  return client;
}
async function listen() {
  const app = await makeServer({ taste: new SyntheticTasteSource() });
  closers.push(() => app.close());
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address(); const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { app, url: new URL(`http://127.0.0.1:${port}/mcp`), base: `http://127.0.0.1:${port}` };
}
async function httpClient(url: URL) {
  const client = new Client({ name: 'http-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(url));
  closers.push(() => client.close());
  return client;
}

describe('agent tool registry', () => {
  it('exposes ten uniquely named tools with LLM descriptions and JSON Schema', () => {
    expect(agentTools.map(t => t.name)).toEqual(['get_workspace', 'get_taste_dna', 'search_films', 'generate_programme', 'explain_film', 'approve_programme', 'withdraw_rights', 'repair_programme', 'compare_versions', 'export_programme']);
    for (const t of agentTools) { expect(t.description.length).toBeGreaterThan(80); expect(toolInputJsonSchema(t).type).toBe('object'); expect(toolInputJsonSchema(t)).not.toHaveProperty('$schema'); }
    expect(toolDeclarations().find(d => d.name === 'generate_programme')!.parameters).toMatchObject({ properties: { mode: { enum: ['QLOO', 'DEMO'] } } });
    expect(agentTools.find(t => t.name === 'approve_programme')!.description).toMatch(/explicit/i);
  });
  it('invokeAgentTool validates input and reports expected failures without throwing', async () => {
    const ctx = { sessionId: 's', store: new MemoryStore(() => createInitialState('memory')), taste: new SyntheticTasteSource() };
    expect(await invokeAgentTool(ctx, 'nope', {})).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TOOL' } });
    expect(await invokeAgentTool(ctx, 'explain_film', {})).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await invokeAgentTool(ctx, 'explain_film', { filmId: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await invokeAgentTool(ctx, 'generate_programme', { mode: 'DEMO' })).toMatchObject({ ok: true });
  });
});

describe('MCP server (in-memory transport)', () => {
  it('lists tools and prompts', async () => {
    const c = await inMemoryClient();
    const { tools } = await c.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(agentTools.map(t => t.name).sort());
    expect(tools.find(t => t.name === 'withdraw_rights')!.inputSchema.properties).toHaveProperty('filmId');
    const { prompts } = await c.listPrompts();
    expect(prompts.map(p => p.name).sort()).toEqual(['handle_rights_change', 'plan_season']);
    const p = await c.getPrompt({ name: 'handle_rights_change', arguments: { film: 'Her' } });
    expect((p.messages[0]!.content as { text: string }).text).toContain('Her');
  });

  it('runs the full flow: workspace -> generate(DEMO) -> approve -> withdraw -> repair -> compare -> export', async () => {
    const c = await inMemoryClient();
    const ws = await call(c, 'get_workspace');
    expect(ws.data.cohorts).toHaveLength(3); expect(ws.data.slots).toHaveLength(4); expect(ws.data.qloo.configured).toBe(false); expect(ws.data.programmes).toEqual([]);
    expect(JSON.stringify(ws.data)).not.toMatch(/api[_-]?key/i);

    const taste = await call(c, 'get_taste_dna');
    expect(taste.data.provenance.source).toBe('SYNTHETIC_DEMO'); expect(taste.data.cohorts).toHaveLength(3);

    const search = await call(c, 'search_films', { query: 'drama', limit: 3 });
    expect(search.data.films.length).toBeGreaterThan(0); expect(search.data.films[0].rights.source).toBe('SYNTHETIC');

    const gen = await call(c, 'generate_programme', { mode: 'DEMO' });
    expect(gen.isError).toBe(false);
    const draft = gen.data.programme;
    expect(draft.status).toBe('DRAFT'); expect(draft.films).toHaveLength(4); expect(draft.mode).toBe('DEMO'); expect(draft.evidenceSynthetic).toBe(true);
    expect(draft.totalCostPence).toBeLessThanOrEqual(draft.budgetPence); expect(draft.coverage).toHaveLength(3);
    for (const f of draft.films) expect(f.why.length).toBeGreaterThan(10);

    const explained = await call(c, 'explain_film', { filmId: draft.films[0].filmId });
    expect(explained.data.cohortFit).toHaveLength(3); expect(explained.data.programmed.versionId).toBe(draft.versionId);

    // approval needs explicit confirmation
    expect((await call(c, 'approve_programme', { versionId: draft.versionId })).isError).toBe(true);
    expect((await call(c, 'export_programme')).data.error?.code).toBe('APPROVAL_REQUIRED');
    const approved = await call(c, 'approve_programme', { versionId: draft.versionId, userConfirmed: true });
    expect(approved.data.programme.status).toBe('APPROVED');
    expect((await call(c, 'export_programme')).data.rightsEnquiryDraft).toContain('NOT SENT');

    const victim = draft.films[0];
    const withdrawn = await call(c, 'withdraw_rights', { filmId: victim.filmId, reason: 'Distributor pulled it' });
    expect(withdrawn.isError).toBe(false);
    expect(withdrawn.data.invalidatedVersions.map((v: Data) => v.versionId)).toEqual([draft.versionId]);
    const repair = withdrawn.data.repairDraft;
    expect(repair.status).toBe('DRAFT'); expect(repair.films.map((f: Data) => f.filmId)).not.toContain(victim.filmId);
    expect(withdrawn.data.diff.swapped.length).toBeGreaterThanOrEqual(1); expect(withdrawn.data.diff.swapped[0].before.filmId).toBe(victim.filmId);
    expect(typeof withdrawn.data.diff.costDeltaPence).toBe('number');

    const repaired = await call(c, 'repair_programme', {});
    expect(repaired.data.reusedExistingRepair).toBe(true); expect(repaired.data.repairDraft.versionId).toBe(repair.versionId);
    const again = await call(c, 'repair_programme', { versionId: draft.versionId, policy: 'GLOBAL_FAIRNESS' });
    expect(again.data.reusedExistingRepair).toBe(false);

    const cmp = await call(c, 'compare_versions', { fromVersionId: draft.versionId, toVersionId: repair.versionId });
    expect(cmp.data.swapped).toEqual(withdrawn.data.diff.swapped); expect(cmp.data.coverage).toHaveLength(3);

    expect((await call(c, 'approve_programme', { versionId: draft.versionId, userConfirmed: true })).isError).toBe(true); // invalidated
    expect((await call(c, 'approve_programme', { versionId: repair.versionId, userConfirmed: true })).data.programme.status).toBe('APPROVED');
  });

  it('reports a blocked QLOO generation as a tool error without leaking configuration', async () => {
    const c = await inMemoryClient();
    const r = await call(c, 'generate_programme', { mode: 'QLOO' });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/GENERATION_BLOCKED/);
  });
});

describe('MCP over Streamable HTTP (/mcp)', () => {
  it('serves the full flow over HTTP with isolated per-session workspaces', async () => {
    const { url } = await listen();
    const a = await httpClient(url), b = await httpClient(url);
    expect((await a.listTools()).tools).toHaveLength(10);
    const gen = await call(a, 'generate_programme', { mode: 'DEMO' });
    expect(gen.data.programme.films).toHaveLength(4);
    expect((await call(a, 'get_workspace')).data.programmes).toHaveLength(1);
    expect((await call(b, 'get_workspace')).data.programmes).toHaveLength(0); // isolation
    expect((await call(b, 'explain_film', { filmId: 'x' })).isError).toBe(true);
  });

  it('applies Origin rules: no Origin ok, allowed Origin ok, foreign Origin rejected', async () => {
    const { url } = await listen();
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
    const post = (origin?: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(origin ? { origin } : {}) }, body: JSON.stringify(init) });
    const none = await post(); expect(none.status).toBe(200); expect(none.headers.get('mcp-session-id')).toBeTruthy();
    expect((await post('http://localhost:5173')).status).toBe(200);
    const evil = await post('https://evil.example'); expect(evil.status).toBe(403); expect(((await evil.json()) as Data).error).toBe('ORIGIN_DENIED');
    expect((await fetch(url, { method: 'GET', headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(url, { method: 'DELETE', headers: { origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('rejects unknown sessions, missing session ids and oversized bodies cleanly', async () => {
    const { url } = await listen();
    const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    expect((await fetch(url, { method: 'POST', headers: { ...h, 'mcp-session-id': 'nope' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })).status).toBe(404);
    expect((await fetch(url, { method: 'POST', headers: h, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })).status).toBe(400);
    expect((await fetch(url, { method: 'GET', headers: { accept: 'text/event-stream' } })).status).toBe(400);
    const big = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', params: { pad: 'a'.repeat(70_000) } }) });
    expect(big.status).toBe(413);
  });

  it('DELETE ends a session and discards its workspace', async () => {
    const { url } = await listen();
    const t = new StreamableHTTPClientTransport(url); const c = new Client({ name: 'd', version: '1' }); await c.connect(t);
    await call(c, 'generate_programme', { mode: 'DEMO' });
    const sid = t.sessionId!; await t.terminateSession();
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
    expect(r.status).toBe(404);
    await c.close().catch(() => undefined);
  });

  it('leaves existing routes and the cookie/CSRF protections unaffected', async () => {
    const { base } = await listen();
    expect(((await (await fetch(`${base}/healthz`)).json()) as Data).ok).toBe(true);
    const state = await fetch(`${base}/api/state`); expect(state.status).toBe(200); expect(state.headers.get('set-cookie')).toContain('rr_session');
    expect((await fetch(`${base}/api/state`, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(`${base}/api/programmes/generate`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}' })).status).toBe(403);
    expect((await fetch(`${base}/mcp-nope`, { method: 'POST' })).status).toBe(404);
  });
});

describe('McpSessionManager bounds', () => {
  it('evicts least-recently-used sessions beyond maxSessions and expires idle ones', async () => {
    let now = 0;
    const m = new McpSessionManager(new SyntheticTasteSource(), { maxSessions: 2, idleTtlMs: 1000, now: () => now });
    closers.push(() => m.close());
    const create = () => (m as unknown as { create(): Promise<{ id: string }> }).create();
    const s1 = await create(); now = 1; const s2 = await create(); now = 2; const s3 = await create();
    expect(m.size).toBe(2);
    const alive = (m as unknown as { sessions: Map<string, unknown> }).sessions;
    expect(alive.has(s1.id)).toBe(false); expect(alive.has(s2.id)).toBe(true); expect(alive.has(s3.id)).toBe(true);
    now = 5000; await m.sweep(); expect(m.size).toBe(0);
  });
});
