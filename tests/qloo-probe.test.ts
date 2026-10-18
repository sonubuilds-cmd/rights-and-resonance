import { describe, expect, it } from 'vitest';
import { createDemoData } from '@rr/domain';
import { QlooClient } from '@rr/qloo';
import { createShareableProbeSummary, runProbe } from '../scripts/qloo-probe';

const fakeKey = 'SYNTHETIC_TEST_KEY_DO_NOT_USE';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const body = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const make = (fetchImpl: typeof fetch) => new QlooClient({ transport: 'direct-http', apiKey: fakeKey, fetchImpl, maxAttempts: 1 });

describe('probe reporting and quota safety with synthetic responses only', () => {
  it('runs all feasibility gates on a complete synthetic provider contract', async () => {
    const demo = createDemoData();
    let profiles = 0;
    const client = make(async input => {
      const url = new URL(String(input));
      if (url.pathname === '/search') {
        const query = url.searchParams.get('query')!;
        const type = url.searchParams.get('types')!;
        const film = type === 'urn:entity:movie' ? demo.films.find(item => item.title === query) : undefined;
        const seedIndex = demo.cohorts.flatMap(c => c.seeds).findIndex(s => s.name === query);
        return body({ success: true, results: [{ entity_id: id(film ? demo.films.indexOf(film) + 1 : seedIndex + 101), name: query, subtype: type, properties: film ? { release_year: film.year } : {} }] });
      }
      expect(url.pathname).toBe('/v2/insights');
      const cohort = profiles++;
      const universe = url.searchParams.get('filter.results.entities')!.split(',');
      return body({ success: true, results: { entities: universe.map((entity_id, index) => ({ entity_id, name: `Synthetic film ${index}`, subtype: 'urn:entity:movie', query: { affinity: ((index + cohort * 10) % universe.length) / (universe.length - 1) } })) } });
    });
    const report = await runProbe(client);
    expect(report.status).toBe('PASS'); expect(report.mappedFilmCount).toBe(30); expect(profiles).toBe(3);
    expect(Object.values(report.gates)).toEqual([true, true, true, true]);
    const summary = createShareableProbeSummary(report);
    expect(summary.status).toBe('PASS'); expect(summary.observed.profilesReturned).toBe(3);
    expect(summary.explainability.every(item => item.status === 'UNAVAILABLE')).toBe(true);
    expect(JSON.stringify(summary)).not.toContain(fakeKey);
  });

  it.each([401, 403, 429, 500])('stops after HTTP %s instead of sending the remaining catalogue queries', async status => {
    let calls = 0;
    const client = make(async () => { calls++; return body({ authorization: fakeKey }, status, { 'retry-after': '3600' }); });
    const report = await runProbe(client);
    expect(calls).toBe(1); expect(report.status).toBe('FAIL'); expect(report.stoppedEarly?.stage).toBe('film-mapping');
    expect(report.mappings).toHaveLength(1); expect(report.seeds).toHaveLength(0); expect(report.profiles).toHaveLength(0);
    expect(report.mappedFilmCount).toBeNull(); expect(report.gates.atLeast25Mapped).toBeNull();
    expect(JSON.stringify(report)).not.toContain(fakeKey);
    expect(createShareableProbeSummary(report).failures[0]?.httpStatus).toBe(status);
  });

  it('exports only an allowlisted summary even if retained evidence contains sensitive provider content', async () => {
    const report = structuredClone(await runProbe(new QlooClient({ transport: 'direct-http' })));
    const hostile = report as any;
    hostile.reason = fakeKey;
    hostile.provider.unexpectedHeaders = { Authorization: `Bearer ${fakeKey}` };
    hostile.readiness.harness.message = fakeKey;
    hostile.evidence = [{ raw: { 'X-Api-Key': fakeKey, request: { headers: { authorization: fakeKey } } } }];
    hostile.mappings = [{ filmId: fakeKey, title: fakeKey, resolution: { status: 'ambiguous', candidates: [fakeKey] }, failure: { code: fakeKey, message: fakeKey, metadata: { endpoint: fakeKey, requestHash: fakeKey } } }];
    hostile.explainabilityChecks[0].providerWarning = fakeKey;
    const summary = createShareableProbeSummary(report);
    const output = JSON.stringify(summary);
    expect(output).not.toContain(fakeKey); expect(output).not.toContain('Authorization'); expect(output).not.toContain('X-Api-Key');
    expect(summary.failures[0]?.code).toBe('PROBE_FAILED'); expect(summary.mappedFilmCount).toBeNull();
  });

  it('rejects JSON-escaped credential echoes before storing raw evidence', async () => {
    const escaped = [...fakeKey].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
    const client = make(async () => new Response(`{"success":true,"results":[],"echo":"${escaped}"}`));
    await expect(client.search('Example')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', message: 'Qloo response failed the safety boundary' });
  });
});
