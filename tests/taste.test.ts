import { afterEach, describe, expect, it } from 'vitest';
import { createDemoData, createSyntheticTasteProfile, TasteProfileSchema } from '@rr/domain';
import { makeServer, type FastifyInstance } from '../apps/api/src/server.js';
import { MemoryStore } from '../apps/api/src/store.js';
import { createInitialState } from '../apps/api/src/state.js';
import { QlooClient } from '@rr/qloo';
import { LiveQlooTasteSource, createTasteSource, SyntheticTasteSource } from '../apps/api/src/taste.js';

describe('synthetic Taste DNA profile', () => {
  const demo = createDemoData();
  const profile = createSyntheticTasteProfile();
  it('is valid, labelled synthetic and covers every cohort and film', () => {
    expect(TasteProfileSchema.parse(profile)).toBeTruthy();
    expect(profile.source).toBe('SYNTHETIC_DEMO');
    expect(profile.status).toBe('ok');
    expect(profile.message).toMatch(/SYNTHETIC/);
    expect(profile.cohorts.map(c => c.cohortId)).toEqual(demo.cohorts.map(c => c.id));
    expect(profile.films.map(f => f.filmId)).toEqual(demo.films.map(f => f.id));
  });
  it('has bounded, sorted tags and consistent shared tags', () => {
    for (const c of profile.cohorts) {
      expect(c.tags.length).toBeGreaterThan(0); expect(c.tags.length).toBeLessThanOrEqual(8);
      expect(Math.max(...c.tags.map(t => t.weight))).toBe(1);
      expect(c.tags.every(t => t.weight >= 0 && t.weight <= 1)).toBe(true);
    }
    for (const f of profile.films) {
      expect(f.tags.length).toBeLessThanOrEqual(6);
      expect(f.why.length).toBeGreaterThan(10);
      for (const s of f.sharedTags) {
        const cohort = profile.cohorts.find(c => c.cohortId === s.cohortId)!;
        for (const id of s.tagIds) {
          expect(f.tags.some(t => t.id === id)).toBe(true);
          expect(cohort.tags.some(t => t.id === id)).toBe(true);
        }
      }
    }
  });
  it('is deterministic', () => {
    expect(JSON.stringify(createSyntheticTasteProfile())).toBe(JSON.stringify(profile));
  });
});

describe('GET /api/taste', () => {
  const servers: FastifyInstance[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close())); });
  async function make() {
    const app = await makeServer({ store: new MemoryStore(() => createInitialState()) });
    servers.push(app); return app;
  }
  it('returns the synthetic profile, sets a session cookie and disables caching', async () => {
    const app = await make();
    const res = await app.inject({ method: 'GET', url: '/api/taste' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(String(res.headers['set-cookie'])).toContain('rr_session=');
    const body = TasteProfileSchema.parse(res.json());
    expect(body.source).toBe('SYNTHETIC_DEMO');
    expect(body).toEqual(createSyntheticTasteProfile());
  });
  it('enforces the same origin allowlist as other endpoints', async () => {
    const app = await make();
    const res = await app.inject({ method: 'GET', url: '/api/taste', headers: { origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
  });
  it('reports unavailable (never fabricated) from the live source without a key', async () => {
    const app = await makeServer({ store: new MemoryStore(() => createInitialState()), taste: new LiveQlooTasteSource({ client: () => new QlooClient({}) }) });
    servers.push(app);
    const body = (await app.inject({ method: 'GET', url: '/api/taste' })).json();
    expect(body).toMatchObject({ source: 'QLOO_LIVE', status: 'unavailable', cohorts: [], films: [] });
    expect(body.message).toMatch(/QLOO_API_KEY/);
  });
  it('selects the synthetic source by default', () => {
    expect(createTasteSource({})).toBeInstanceOf(SyntheticTasteSource);
    expect(createTasteSource({ TASTE_SOURCE: 'qloo' })).toBeInstanceOf(LiveQlooTasteSource);
  });
});
