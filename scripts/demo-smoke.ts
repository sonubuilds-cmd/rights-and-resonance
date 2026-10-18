/** Real loopback HTTP check of the synthetic workflow. No provider or database calls. */
import assert from 'node:assert/strict';
import { makeServer } from '../apps/api/src/server';
import { MemoryStore } from '../apps/api/src/store';
import { createInitialState } from '../apps/api/src/state';
import type { AppState } from '../apps/api/src/types';

process.env.QLOO_API_KEY = '';
process.env.LLM_API_KEY = '';
process.env.LLM_MODEL = '';
process.env.ALLOWED_ORIGINS = 'http://127.0.0.1:5173';
const app = await makeServer({ store: new MemoryStore(() => createInitialState()) });
let cookie = '';
try {
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  async function api(path: string, method = 'GET', payload?: unknown, status = 200): Promise<any> {
    const response = await fetch(base + path, { method, headers: { origin: 'http://127.0.0.1:5173', ...(cookie ? { cookie } : {}), ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0]!;
    const result = await response.json(); assert.equal(response.status, status); return result;
  }
  const health = await api('/healthz'); assert.equal(health.ok, true);
  const initial: AppState = await api('/api/state'); assert.equal(initial.providerStatus.qlooConfigured, false);
  const generated: AppState = await api('/api/programmes/generate', 'POST', { mode: 'DEMO' });
  const original = generated.versions.at(-1)!; assert.equal(original.status, 'DRAFT'); assert.equal(original.items.length, 4);
  await api(`/api/programme-versions/${original.id}/export`, 'GET', undefined, 409);
  await api(`/api/programmes/${original.programmeId}/approve`, 'POST', { versionId: original.id });
  const before = await api(`/api/programme-versions/${original.id}/export`); assert.equal(before.evidence.sourceLabel, 'SYNTHETIC_DEMO');
  const changed: AppState = await api('/api/events/rights-revoked', 'POST', { filmId: original.items[0]!.filmId, reason: 'Synthetic HTTP smoke-test withdrawal' });
  assert.equal(changed.versions.find(v => v.id === original.id)!.status, 'INVALIDATED');
  const repaired = changed.versions.at(-1)!; assert.equal(repaired.status, 'DRAFT'); assert.equal(repaired.parentVersionId, original.id);
  assert(!repaired.items.some(item => item.filmId === original.items[0]!.filmId));
  await api(`/api/programme-versions/${original.id}/export`, 'GET', undefined, 409);
  await api(`/api/programmes/${repaired.programmeId}/approve`, 'POST', { versionId: repaired.id });
  const exported = await api(`/api/programme-versions/${repaired.id}/export`);
  assert.equal(exported.programme.status, 'APPROVED'); assert.equal(exported.evidence.synthetic, true);
  const diff = await api(`/api/programme-versions/${original.id}/diff/${repaired.id}`);
  assert.equal(diff.changes.filter((item: { changed: boolean }) => item.changed).length, 1);
  const fresh = await fetch(base + '/api/state').then(response => response.json()) as AppState; assert.equal(fresh.versions.length, 0);
  console.log(JSON.stringify({ status: 'PASS', transport: 'real loopback HTTP', health, workflow: ['generate', 'block draft export', 'approve', 'export', 'revoke rights', 'invalidate', 'repair', 'block invalidated export', 'reapprove', 'export', 'compare versions', 'isolate session'], originalTitles: original.items.map(i => i.filmTitle), repairedTitles: repaired.items.map(i => i.filmTitle), repairedCostGBP: repaired.totalCost / 100, changedSlots: 1, evidence: 'SYNTHETIC_DEMO', liveQloo: 'NOT_TESTED' }, null, 2));
} finally { await app.close(); }
