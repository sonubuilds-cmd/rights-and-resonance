import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from '../../apps/api/src/server.js';
import type { AppState } from '../../apps/api/src/types.js';

const servers: FastifyInstance[] = [];
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('QLOO_API_KEY', '');
  vi.stubEnv('QLOO_BASE_URL', undefined);
  vi.stubEnv('QLOO_TRANSPORT', undefined);
  // No test in this suite is permitted to reach a provider.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request in local readiness test'); }));
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function server(mapped = false, storedConfiguration?: boolean) {
  const [{ makeServer }, { MemoryStore }, { createInitialState }] = await Promise.all([
    import('../../apps/api/src/server.js'), import('../../apps/api/src/store.js'), import('../../apps/api/src/state.js'),
  ]);
  const app = await makeServer({ store: new MemoryStore(() => {
    const state = createInitialState();
    if (storedConfiguration !== undefined) state.providerStatus.qlooConfigured = storedConfiguration;
    if (mapped) {
      state.films.forEach(film => { film.qlooEntityId = randomUUID(); film.mappingStatus = 'CONFIRMED'; });
      state.cohorts.forEach(cohort => cohort.seeds.forEach(seed => { seed.entityId = randomUUID(); }));
    }
    return state;
  }) });
  servers.push(app);
  return app;
}

describe('local Qloo readiness and transport integration', () => {
  it('refreshes credential availability from the server rather than stale persisted session flags', async () => {
    const app = await server(false, true);
    const first = await app.inject({ method: 'GET', url: '/api/state' });
    const cookie = String(first.headers['set-cookie']).split(';')[0]!;
    expect(first.json<AppState>().providerStatus.qlooConfigured).toBe(false);
    // Simulate a persisted session that was created before this process's configuration.
    vi.stubEnv('QLOO_API_KEY', 'test-credential-never-transmitted');
    const next = await app.inject({ method: 'GET', url: '/api/state', headers: { cookie } });
    expect(next.json<AppState>().providerStatus.qlooConfigured).toBe(true);
    expect(next.json<AppState>().providerStatus.qlooStatus).toBe('UNVERIFIED');
    expect(next.json<AppState>().evidence).toEqual(first.json<AppState>().evidence);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('defaults to the official harness and hackathon endpoint without claiming live access when no key exists', async () => {
    const app = await server();
    const response = await app.inject({ method: 'GET', url: '/api/qloo/readiness' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      configured: false, ready: false, transport: 'harness', baseUrl: 'https://hackathon.api.qloo.com', liveVerification: 'UNVERIFIED',
      harness: { package: '@qloo/qloo-harness', minimumVersion: '0.1.26' },
    });
    const state = (await app.inject({ method: 'GET', url: '/api/state' })).json<AppState>();
    expect(state.providerStatus).toMatchObject({ qlooConfigured: false, qlooStatus: 'UNVERIFIED' });
    expect(state.evidence).toEqual([]);
    expect(state.runs).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a configured key and installed harness separate from live verification without exposing the key', async () => {
    const key = 'test-credential-never-transmitted';
    vi.stubEnv('QLOO_API_KEY', key);
    const app = await server();
    const response = await app.inject({ method: 'GET', url: '/api/qloo/readiness' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ configured: true, transport: 'harness', liveVerification: 'UNVERIFIED' });
    expect(response.json().harness.status).toBe('READY');
    expect(response.json().harness.capabilities.length).toBeGreaterThan(0);
    expect(response.body).not.toContain(key);
    const state = (await app.inject({ method: 'GET', url: '/api/state' })).json<AppState>();
    expect(state.providerStatus.qlooStatus).toBe('CONFIGURED_NOT_VERIFIED');
    expect(state.evidence).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('labels direct HTTP only when explicitly selected and still leaves the live gate unverified', async () => {
    vi.stubEnv('QLOO_TRANSPORT', 'direct-http');
    vi.stubEnv('QLOO_API_KEY', 'test-credential-never-transmitted');
    const app = await server();
    const response = await app.inject({ method: 'GET', url: '/api/qloo/readiness' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ transport: 'direct-http', liveVerification: 'UNVERIFIED', harness: { status: 'NOT_USED' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a wrong endpoint before any provider request instead of silently changing transports', async () => {
    vi.stubEnv('QLOO_API_KEY', 'test-credential-never-transmitted');
    vi.stubEnv('QLOO_BASE_URL', 'https://api.qloo.com');
    const app = await server();
    const response = await app.inject({ method: 'GET', url: '/api/qloo/readiness' });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe('QLOO_INVALID_REQUEST');
    expect(response.body).not.toContain('test-credential-never-transmitted');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains typed provider failure provenance and never substitutes synthetic evidence', async () => {
    vi.stubEnv('QLOO_API_KEY', 'test-credential-never-transmitted');
    const app = await server(true);
    const [{ qloo }, { QlooError }] = await Promise.all([import('../../apps/api/src/evidence.js'), import('@rr/qloo')]);
    const failure = new QlooError('FORBIDDEN', 'Qloo denied access to this resource', false, 403, {
      transport: 'harness', baseUrl: 'https://hackathon.api.qloo.com', endpoint: '/v2/insights', requestHash: 'provider-request-hash', attempts: 1,
    });
    const provider = vi.spyOn(qloo(), 'insights').mockRejectedValue(failure);
    const response = await app.inject({ method: 'POST', url: '/api/programmes/generate', payload: { mode: 'QLOO' } });
    expect(response.statusCode, response.body).toBe(422);
    const state = response.json().state as AppState;
    expect(state.versions).toHaveLength(0);
    expect(state.runs.at(-1)?.status).toBe('FAILED');
    const evidence = state.evidence.at(-1)!;
    expect(evidence.mode).toBe('QLOO');
    expect(evidence.synthetic).toBe(false);
    expect(evidence.sourceLabel).toBe('QLOO_BLOCKED_EVIDENCE');
    expect(evidence.providerResponses).toEqual([expect.objectContaining({
      status: 'FAILED', endpoint: '/v2/insights', errorCode: 'FORBIDDEN', httpStatus: 403, retryable: false,
      provider: { transport: 'harness', baseUrl: 'https://hackathon.api.qloo.com', endpoint: '/v2/insights', requestHash: 'provider-request-hash', attempts: 1 },
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/), candidateUniverseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })]);
    expect(Object.values(evidence.affinities).flatMap(Object.values).every(value => value === null)).toBe(true);
    expect(response.body).not.toContain('test-credential-never-transmitted');
    expect(provider).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});
