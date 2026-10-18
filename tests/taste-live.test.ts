/** Every provider payload here is a SYNTHETIC mock in the recorded live shape. No network is used. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TasteProfileSchema, createDemoData } from '@rr/domain';
import { QlooClient, TAG_INSIGHTS_PARAMETER_ALLOWLIST, extractEntityTags, parseQlooTags, type HarnessRunner } from '@rr/qloo';
import { makeServer, type FastifyInstance } from '../apps/api/src/server.js';
import { MemoryStore } from '../apps/api/src/store.js';
import { createInitialState, defaultEvidenceMode } from '../apps/api/src/state.js';
import { LiveQlooTasteSource, buildLiveTasteProfile, loadResolvedMappings, normalizePool } from '../apps/api/src/taste-live.js';
import { createTasteSource, SyntheticTasteSource } from '../apps/api/src/taste.js';

const KEY = 'SYNTHETIC_TEST_KEY_DO_NOT_USE';
const mappings = loadResolvedMappings();
const demo = createDemoData();
const THEMES = ['Emotional Growth', 'Unrequited Love', 'Alternate Realities', 'Social Alienation', 'Dreams Vs Reality', 'Critical Thinking', 'Self-Sufficiency', 'Coming Of Age', 'Loss And Grief', 'Found Family'];
const tid = (n: string) => `urn:tag:theme:qloo:${n.toLowerCase().replace(/[^a-z]+/g, '_')}`;
const idx = (id: string) => [...new Set(Object.values(mappings.films))].indexOf(id);
const filmByEntity = new Map(demo.films.map(f => [mappings.films[f.id]!, f]));
const entityRecord = (id: string) => ({
  name: filmByEntity.get(id)?.title ?? 'x', entity_id: id, types: ['urn:entity:movie'], popularity: 0.5, disambiguation: '', properties: { release_year: filmByEntity.get(id)?.year },
  tags: [{ name: 'Boat', tag_id: 'urn:tag:keyword:media:boat', type: 'urn:tag:keyword:media' }, { name: 'Action', tag_id: 'urn:tag:genre:media:action', type: 'urn:tag:genre:media' },
    ...[0, 1, 2, 3].map(k => THEMES[(idx(id) + k) % THEMES.length]!).map(n => ({ name: n, tag_id: tid(n), type: 'urn:tag:theme:qloo' }))],
});
const seedsOf = (url: URL) => url.searchParams.get('signal.interests.entities')!.split(',');
type Opts = { failTagsFor?: string; calls?: URL[] };
function runner(opts: Opts = {}): HarnessRunner {
  return async (input) => {
    if (input.action !== 'request') return { ok: true, version: '0.1.26', capabilities: ['api search', 'api entity', 'api insights'], networkCalls: 0 };
    const url = new URL(input.url); opts.calls?.push(url);
    const reply = (raw: unknown, httpStatus = 200) => ({ ok: true as const, version: '0.1.26', command: 'insights', cliExitCode: 0, httpStatus, retryAfter: null, text: JSON.stringify(raw) });
    if (url.pathname === '/entities') return reply({ results: url.searchParams.get('entity_ids')!.split(',').map(entityRecord) });
    const seeds = seedsOf(url);
    if (url.searchParams.get('filter.type') === 'urn:tag') {
      if (opts.failTagsFor && seeds.includes(opts.failTagsFor)) return reply({}, 400);
      const shift = demo.cohorts.findIndex(c => c.seeds.some(s => seeds.includes(mappings.seeds[`${c.id}:${s.name}`]!)));
      const pool = Array.from({ length: 50 }, (_, i) => { const n = i < THEMES.length ? THEMES[(i + shift * 3) % THEMES.length]! : `Extra ${'abcdefghij'[i % 10]}${'klmnopqrst'[Math.floor(i / 10)]}`; return { tag_id: tid(n), name: n, types: ['urn:entity:movie'], subtype: 'urn:tag:theme:qloo', popularity: 0.5, query: { affinity: 0.99 - i * 0.004 } }; });
      return reply({ success: true, results: { tags: pool } });
    }
    const universe = url.searchParams.get('filter.results.entities')!.split(',').filter(id => !seeds.includes(id));
    const shift = seeds.length;
    return reply({ success: true, results: { entities: universe.map(id => ({ ...entityRecord(id), tags: undefined, query: { affinity: 0.3 + ((idx(id) * 7 + shift) % 30) / 100 } })) } });
  };
}
const client = (o: Opts = {}) => new QlooClient({ apiKey: KEY, harnessRunner: runner(o), cacheTtlMs: 0 });

describe('Qloo tag helpers', () => {
  it('parses tag insights and entity-record tags without inventing fields', () => {
    const parsed = parseQlooTags({ success: true, results: { tags: [{ tag_id: 'urn:tag:theme:qloo:a', name: ' A ', types: ['urn:entity:movie'], subtype: 'urn:tag:theme:qloo', query: { affinity: 0.9 } }, { name: 'no id' }] } });
    expect(parsed.status).toBe('partial'); expect(parsed.tags).toEqual([{ tagId: 'urn:tag:theme:qloo:a', name: 'A', types: ['urn:entity:movie'], subtype: 'urn:tag:theme:qloo', rawAffinity: 0.9 }]);
    expect(parseQlooTags({ results: { tags: [] } }).status).toBe('unknown');
    expect(extractEntityTags({ raw: { tags: [{ name: 'X', tag_id: 'urn:tag:theme:qloo:x', type: 'urn:tag:theme:qloo' }, { name: 'Y', id: 'urn:tag:genre:media:y' }, 'junk'] } })).toEqual([
      { id: 'urn:tag:theme:qloo:x', name: 'X', type: 'urn:tag:theme:qloo' }, { id: 'urn:tag:genre:media:y', name: 'Y', type: 'urn:tag:genre:media' }]);
  });
  it('sends only allowlisted tag parameters, no key, and validates inputs', async () => {
    const calls: URL[] = [];
    const c = client({ calls });
    await c.tagInsights({ seedEntityIds: [mappings.seeds['film-society:Normal People']!], tagTypes: 'urn:tag:theme:qloo', parentType: 'urn:entity:movie' });
    expect([...calls[0]!.searchParams.keys()].sort()).toEqual([...TAG_INSIGHTS_PARAMETER_ALLOWLIST].sort());
    expect(calls[0]!.origin).toBe('https://hackathon.api.qloo.com'); expect(calls[0]!.toString()).not.toContain(KEY);
    await expect(c.tagInsights({ seedEntityIds: ['nope'] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(c.tagInsights({ seedEntityIds: [mappings.seeds['film-society:Normal People']!], tagTypes: 'urn:tag:x;drop' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(c.tagInsights({ seedEntityIds: [mappings.seeds['film-society:Normal People']!], take: 100 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(c.tagInsights({ seedEntityIds: [mappings.seeds['film-society:Normal People']!], filter: 'x' } as never)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
  it('normalises a pool to relative 0..1', () => {
    const w = normalizePool([{ tagId: 'a', name: 'a', types: [], subtype: null, rawAffinity: 0.99 }, { tagId: 'b', name: 'b', types: [], subtype: null, rawAffinity: 0.97 }, { tagId: 'c', name: 'c', types: [], subtype: null, rawAffinity: null }]);
    expect([...w]).toEqual([['a', 1], ['b', 0]]);
  });
});

describe('LiveQlooTasteSource (mocked Qloo, recorded shapes)', () => {
  it('builds a valid QLOO_LIVE profile from real-shaped data with consistent shared tags and templated why', async () => {
    const calls: URL[] = [];
    const profile = await new LiveQlooTasteSource({ client: () => client({ calls }) }).load();
    expect(TasteProfileSchema.parse(profile)).toBeTruthy();
    expect(profile).toMatchObject({ source: 'QLOO_LIVE', status: 'ok' });
    expect(profile.cohorts.map(c => c.cohortId)).toEqual(demo.cohorts.map(c => c.id));
    for (const c of profile.cohorts) { expect(c.tags).toHaveLength(8); expect(Math.max(...c.tags.map(t => t.weight))).toBe(1); expect(c.tags.every(t => t.weight >= 0 && t.weight <= 1)).toBe(true); }
    expect(profile.films).toHaveLength(30);
    const nameOf = new Map([...profile.cohorts.flatMap(c => c.tags), ...profile.films.flatMap(f => f.tags)].map(t => [t.id, t.name]));
    for (const f of profile.films) {
      expect(f.tags.length).toBeLessThanOrEqual(6);
      for (const s of f.sharedTags) { expect(profile.cohorts.some(c => c.cohortId === s.cohortId)).toBe(true); for (const id of s.tagIds) { expect(f.tags.some(t => t.id === id)).toBe(true); } }
      if (f.sharedTags.length) { expect(f.why).toMatch(/^Shares the Qloo themes /); expect(f.why).toContain(nameOf.get(f.sharedTags[0]!.tagIds[0]!)!.toLowerCase()); }
    }
    expect(profile.films.some(f => /ranks it #\d+ of \d+ candidate films/.test(f.why))).toBe(true);
    expect(profile.workflow.join('|')).toMatch(/qloo api \/entities.*qloo api \/v2\/insights \(urn:tag/);
    expect(profile.workflow.join('|')).toMatch(/no LLM/);
    // 1 entities + 3 tag + 3 ranking requests, every one against the pinned origin with no key.
    expect(calls).toHaveLength(7); expect(calls.every(u => u.origin === 'https://hackathon.api.qloo.com' && !u.toString().includes(KEY))).toBe(true);
    expect(JSON.stringify(profile)).not.toContain(KEY);
  });
  it('caches in-process for the TTL and de-duplicates concurrent loads', async () => {
    const calls: URL[] = []; let t = 0;
    const source = new LiveQlooTasteSource({ client: () => client({ calls }), cacheTtlMs: 1000, now: () => t });
    const [a, b] = await Promise.all([source.load(), source.load()]); expect(calls).toHaveLength(7); expect(b).toEqual(a);
    t = 999; await source.load(); expect(calls).toHaveLength(7);
    t = 1001; await source.load(); expect(calls).toHaveLength(14);
  });
  it('reports partial honestly when one cohort cannot be profiled (no invented tags)', async () => {
    const profile = await new LiveQlooTasteSource({ client: () => client({ failTagsFor: mappings.seeds['alternative-music:Radiohead'] }) }).load();
    expect(profile.status).toBe('partial'); expect(profile.message).toMatch(/Alternative Music tag insights failed/);
    expect(profile.cohorts.find(c => c.cohortId === 'alternative-music')!.tags).toEqual([]);
    expect(profile.cohorts.find(c => c.cohortId === 'film-society')!.tags.length).toBe(8);
    expect(profile.films.flatMap(f => f.sharedTags).some(s => s.cohortId === 'alternative-music')).toBe(false);
  });
  it('is unavailable without a key and when every request fails', async () => {
    const none = await new LiveQlooTasteSource({ client: () => new QlooClient({ harnessRunner: runner() }) }).load();
    expect(none).toMatchObject({ source: 'QLOO_LIVE', status: 'unavailable', cohorts: [], films: [] }); expect(none.message).toMatch(/QLOO_API_KEY/);
    const down = await new LiveQlooTasteSource({ client: () => new QlooClient({ apiKey: KEY, maxAttempts: 1, harnessRunner: async input => input.action === 'request' ? { ok: true, version: '0.1.26', command: 'x', cliExitCode: 0, httpStatus: 500, retryAfter: null, text: '' } : { ok: true, version: '0.1.26' } }) }).load();
    expect(down.status).not.toBe('ok'); expect(down.source).toBe('QLOO_LIVE');
    expect(down.films.every(f => f.tags.length === 0)).toBe(true);
  });
  it('builder: a film with no overlap says so and never mentions invented tags', () => {
    const profile = buildLiveTasteProfile({ generatedAt: '2026-10-18T00:00:00.000Z', cohorts: [{ id: 'c', name: 'Cohort' }], films: [{ id: 'f', title: 'F' }],
      cohortPools: new Map([['c', [{ tagId: 'urn:tag:theme:qloo:a', name: 'A', types: [], subtype: null, rawAffinity: 0.9 }, { tagId: 'urn:tag:theme:qloo:b', name: 'B', types: [], subtype: null, rawAffinity: 0.8 }]]]),
      filmRecords: new Map([['f', [{ id: 'urn:tag:theme:qloo:z', name: 'Z', type: 'urn:tag:theme:qloo' }]]]), ranks: new Map([['c', new Map([['f', { rank: 3, of: 29 }]])]]), workflow: [], warnings: [] });
    expect(profile.films[0]!.sharedTags).toEqual([]);
    expect(profile.films[0]!.why).toBe('No Qloo theme overlap with any cohort\'s top themes; Qloo ranks it #3 of 29 candidate films for Cohort, its strongest cohort.');
    expect(profile.status).toBe('partial');
  });
});

describe('source selection and defaults', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('uses live when a key is configured, synthetic when forced or keyless', () => {
    expect(createTasteSource({})).toBeInstanceOf(SyntheticTasteSource);
    expect(createTasteSource({ QLOO_API_KEY: KEY })).toBeInstanceOf(LiveQlooTasteSource);
    expect(createTasteSource({ QLOO_API_KEY: KEY, TASTE_SOURCE: 'synthetic' })).toBeInstanceOf(SyntheticTasteSource);
    expect(createTasteSource({ TASTE_SOURCE: 'qloo' })).toBeInstanceOf(LiveQlooTasteSource);
  });
  it('defaults programme evidence to QLOO only when keyed with the mapping gate met', () => {
    vi.stubEnv('QLOO_API_KEY', '');
    expect(defaultEvidenceMode()).toBe('DEMO'); expect(createInitialState().films.every(f => f.mappingStatus === 'UNMAPPED')).toBe(true);
    vi.stubEnv('QLOO_API_KEY', KEY);
    const s = createInitialState();
    expect(defaultEvidenceMode()).toBe('QLOO'); expect(s.providerStatus.defaultMode).toBe('QLOO');
    expect(s.films.filter(f => f.mappingStatus === 'CONFIRMED' && f.qlooEntityId)).toHaveLength(30);
    expect(s.cohorts.every(c => c.seeds.every(x => x.entityId))).toBe(true);
    expect(s.evidenceMode).toBe('DEMO');
    vi.stubEnv('QLOO_PRECONFIRMED_MAPPINGS', 'off');
    expect(defaultEvidenceMode()).toBe('DEMO');
  });
  describe('GET /api/taste with an injected live source', () => {
    let app: FastifyInstance | undefined;
    afterEach(async () => { await app?.close(); });
    it('serves the cached live profile', async () => {
      app = await makeServer({ store: new MemoryStore(() => createInitialState()), taste: new LiveQlooTasteSource({ client: () => client() }) });
      const body = TasteProfileSchema.parse((await app.inject({ method: 'GET', url: '/api/taste' })).json());
      expect(body).toMatchObject({ source: 'QLOO_LIVE', status: 'ok' });
    });
  });
});
