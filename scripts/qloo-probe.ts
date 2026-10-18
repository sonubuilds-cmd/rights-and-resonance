import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDemoData } from '@rr/domain';
import { QlooClient, QlooError, hashEvidence, resolveFilmMapping, resolveSeedMapping, type MappingResolution, type QlooResult, type QlooInsightsResult } from '@rr/qloo';

const DOMAIN_TYPES: Record<string, string> = {
  music: 'urn:entity:artist', artist: 'urn:entity:artist', books: 'urn:entity:book', book: 'urn:entity:book',
  places: 'urn:entity:place', brands: 'urn:entity:brand', film: 'urn:entity:movie', movie: 'urn:entity:movie',
  tv: 'urn:entity:tv_show', video_game: 'urn:entity:videogame',
};
export type ProbeOverrides = { films?: Record<string, string>; seeds?: Record<string, string> };
const safeFailure = (error: unknown) => error instanceof QlooError ? { code: error.code, message: error.message, httpStatus: error.httpStatus, retryable: error.retryable, metadata: error.metadata } : { code: 'PROBE_FAILED', message: 'Probe step failed; no untrusted error details included' };
const fatalProviderFailure = (error: unknown): error is QlooError => error instanceof QlooError && [
  'UNAUTHORIZED', 'FORBIDDEN', 'RATE_LIMITED', 'NETWORK', 'TIMEOUT', 'UPSTREAM',
  'HARNESS_UNAVAILABLE', 'HARNESS_INCOMPATIBLE', 'HARNESS_CONTRACT',
].includes(error.code);
/** This probe is a feasibility gate, not a synthetic-data demonstration or proof of attendance. */
export async function runProbe(client: QlooClient, overrides: ProbeOverrides = {}) {
  const demo = createDemoData();
  if (demo.films.length !== 30 || demo.cohorts.length !== 3) throw new Error('Probe contract requires exactly 30 films and three cohorts');
  const filmKeys = new Set(demo.films.map(f => f.id));
  const seedKeys = new Set(demo.cohorts.flatMap(c => c.seeds.map(s => `${c.id}:${s.name}`)));
  if (Object.keys(overrides.films ?? {}).some(k => !filmKeys.has(k)) || Object.keys(overrides.seeds ?? {}).some(k => !seedKeys.has(k))) throw new Error('Unknown mapping override key');
  const report = {
    schemaVersion: 2, generatedAt: new Date().toISOString(), status: 'UNVERIFIED' as 'UNVERIFIED' | 'PASS' | 'FAIL',
    notice: 'Live Qloo API feasibility only. Synthetic rights are unrelated. Affinity is not an attendance prediction.',
    provider: client.status(), readiness: await client.readiness(), expectedFilms: 30, expectedCohorts: 3, mappedFilmCount: null as number | null,
    candidateUniverseHash: null as string | null, candidateUniverse: [] as string[],
    gates: { atLeast25Mapped: null as boolean | null, allSeedsResolved: null as boolean | null, completeThreeProfiles: null as boolean | null, usefulDifferentProfiles: null as boolean | null },
    heuristic: 'All three complete profiles must have at least five distinct affinity values. Every profile pair must differ in its top-five set and have mean absolute rank-percentile difference >= 0.05. This is a project feasibility heuristic, not statistical validation.',
    reason: 'QLOO_API_KEY is absent. No Qloo calls were made. Live mapping, response coverage, explainability, and usefulness remain unverified.',
    mappings: [] as Array<{ filmId: string; title: string; year: number; resolution: MappingResolution; manuallyConfirmed: boolean; failure?: ReturnType<typeof safeFailure> }>,
    seeds: [] as Array<{ cohortId: string; name: string; type: string; resolution: MappingResolution; manuallyConfirmed: boolean; failure?: ReturnType<typeof safeFailure> }>,
    profiles: [] as Array<{ cohortId: string; result?: QlooInsightsResult; failure?: ReturnType<typeof safeFailure> }>,
    comparisons: [] as Array<{ cohortA: string; cohortB: string; meanAbsolutePercentileDifference: number; differentTopFive: boolean; useful: boolean }>,
    stoppedEarly: null as null | { stage: 'film-mapping' | 'seed-mapping' | 'profiles'; failure: ReturnType<typeof safeFailure> },
    explainabilityChecks: demo.cohorts.map(cohort => ({ cohortId: cohort.id, status: 'UNVERIFIED' as 'UNVERIFIED' | 'AVAILABLE' | 'UNAVAILABLE', perEntityReturnedCount: null as number | null, aggregateReturned: null as boolean | null, providerWarning: null as unknown })),
    evidence: [] as QlooResult[],
  };
  if (!client.status().configured) return report;
  if (!report.readiness.ready) { report.status = 'FAIL'; report.reason = 'Local official-harness capability check failed. No provider calls or fallback were attempted; live access remains unverified.'; return report; }
  const stop = (stage: NonNullable<typeof report.stoppedEarly>['stage'], error: QlooError) => {
    report.status = 'FAIL'; report.stoppedEarly = { stage, failure: safeFailure(error) };
    report.reason = 'Probe stopped after an authentication, access, quota, availability or transport failure. No further catalogue requests were made; unfinished gates remain unverified.';
    return report;
  };
  const unresolved = (reason: string): MappingResolution => ({ status: 'missing', entityId: null, candidates: [], reason });
  // Deliberately sequential: 30 film lookups, one lookup per configured seed, and 3 profile requests before retries.
  for (const film of demo.films) {
    const override = overrides.films?.[film.id];
    try {
      const response = override ? await client.entities([override]) : await client.search(film.title, { type: 'urn:entity:movie', take: 20 });
      report.evidence.push(response);
      let resolution = resolveFilmMapping(film.title, film.year, response.entities);
      if (response.status !== 'complete' || response.evidence.cache === 'STALE_CACHE') resolution = { ...resolution, status: 'ambiguous', entityId: null, reason: 'Incomplete or stale lookup requires a fresh, confirmed mapping' };
      else if (override) {
        const entity = response.entities.find(e => e.entityId === override.toLowerCase() && e.type === 'urn:entity:movie');
        resolution = entity ? { status: 'mapped', entityId: entity.entityId, candidates: [entity], reason: 'Explicit mapping override verified by /entities' } : unresolved('Override did not resolve to a movie entity');
      }
      report.mappings.push({ filmId: film.id, title: film.title, year: film.year, resolution, manuallyConfirmed: !!override });
    } catch (error) {
      report.mappings.push({ filmId: film.id, title: film.title, year: film.year, resolution: unresolved('Lookup failed'), manuallyConfirmed: !!override, failure: safeFailure(error) });
      if (fatalProviderFailure(error)) return stop('film-mapping', error);
    }
  }
  // Never count one entity ID as two different mapped films.
  const duplicates = new Set(report.mappings.filter(m => m.resolution.entityId && report.mappings.filter(n => n.resolution.entityId === m.resolution.entityId).length > 1).map(m => m.resolution.entityId));
  for (const mapping of report.mappings) if (duplicates.has(mapping.resolution.entityId)) mapping.resolution = { ...mapping.resolution, status: 'ambiguous', entityId: null, reason: 'Entity ID was assigned to multiple catalogue films; confirmation required' };
  for (const cohort of demo.cohorts) for (const seed of cohort.seeds) {
    const type = DOMAIN_TYPES[seed.domain];
    if (!type) throw new Error('Unsupported cohort seed domain');
    const override = overrides.seeds?.[`${cohort.id}:${seed.name}`];
    try {
      const response = override ? await client.entities([override]) : await client.search(seed.name, { type, take: 20 });
      report.evidence.push(response);
      let resolution = resolveSeedMapping(seed.name, type, response.entities);
      if (response.status !== 'complete' || response.evidence.cache === 'STALE_CACHE') resolution = { ...resolution, status: 'ambiguous', entityId: null, reason: 'Incomplete or stale lookup requires a fresh, confirmed mapping' };
      else if (override) {
        const entity = response.entities.find(e => e.entityId === override.toLowerCase() && e.type === type);
        resolution = entity ? { status: 'mapped', entityId: entity.entityId, candidates: [entity], reason: 'Explicit seed override verified by /entities' } : unresolved('Override did not resolve to the requested entity type');
      }
      report.seeds.push({ cohortId: cohort.id, name: seed.name, type, resolution, manuallyConfirmed: !!override });
    } catch (error) {
      report.seeds.push({ cohortId: cohort.id, name: seed.name, type, resolution: unresolved('Lookup failed'), manuallyConfirmed: !!override, failure: safeFailure(error) });
      if (fatalProviderFailure(error)) return stop('seed-mapping', error);
    }
  }
  report.candidateUniverse = report.mappings.flatMap(m => m.resolution.status === 'mapped' && m.resolution.entityId ? [m.resolution.entityId] : []).sort();
  report.mappedFilmCount = report.candidateUniverse.length;
  report.candidateUniverseHash = hashEvidence(report.candidateUniverse);
  report.gates.atLeast25Mapped = report.mappedFilmCount >= 25;
  report.gates.allSeedsResolved = report.seeds.every(s => s.resolution.status === 'mapped');
  for (const cohort of demo.cohorts) {
    const seeds = report.seeds.filter(s => s.cohortId === cohort.id);
    if (!report.gates.atLeast25Mapped || seeds.some(s => !s.resolution.entityId)) {
      report.profiles.push({ cohortId: cohort.id, failure: { code: 'UNRESOLVED_INPUTS', message: 'Profile not requested until the film mapping gate and all cohort seeds resolve' } }); continue;
    }
    try { report.profiles.push({ cohortId: cohort.id, result: await client.insights({ seedEntityIds: [...new Set(seeds.map(s => s.resolution.entityId!))], candidateEntityIds: report.candidateUniverse, explainability: true }) }); }
    catch (error) {
      report.profiles.push({ cohortId: cohort.id, failure: safeFailure(error) });
      if (fatalProviderFailure(error)) return stop('profiles', error);
    }
  }
  for (const profile of report.profiles) {
    if (!profile.result) continue;
    const check = report.explainabilityChecks.find(item => item.cohortId === profile.cohortId)!;
    check.perEntityReturnedCount = profile.result.entities.filter(entity => entity.explainability !== undefined && entity.explainability !== null).length;
    check.aggregateReturned = profile.result.aggregateExplainability !== undefined && profile.result.aggregateExplainability !== null;
    const aggregate = profile.result.aggregateExplainability;
    if (aggregate && typeof aggregate === 'object' && 'warning' in aggregate) check.providerWarning = aggregate.warning;
    check.status = check.perEntityReturnedCount > 0 ? 'AVAILABLE' : 'UNAVAILABLE';
  }
  report.gates.completeThreeProfiles = report.profiles.length === 3 && report.profiles.every(p => p.result?.complete && p.result.evidence.cache !== 'STALE_CACHE' && p.result.evidence.candidateUniverseHash === report.candidateUniverseHash);
  if (report.gates.completeThreeProfiles) {
    for (let i = 0; i < report.profiles.length; i++) for (let j = i + 1; j < report.profiles.length; j++) {
      const a = report.profiles[i]!; const b = report.profiles[j]!;
      const aRows = a.result!.rows; const bRows = b.result!.rows;
      const bById = new Map(bRows.map(row => [row.entityId, row.percentile!]));
      const mean = aRows.reduce((total, row) => total + Math.abs(row.percentile! - bById.get(row.entityId)!), 0) / aRows.length;
      const topFive = (rows: typeof aRows) => rows.slice().sort((x, y) => y.percentile! - x.percentile! || x.entityId.localeCompare(y.entityId)).slice(0, 5).map(x => x.entityId).sort().join(',');
      const differentTopFive = topFive(aRows) !== topFive(bRows);
      report.comparisons.push({ cohortA: a.cohortId, cohortB: b.cohortId, meanAbsolutePercentileDifference: mean, differentTopFive, useful: differentTopFive && mean >= 0.05 });
    }
  }
  report.gates.usefulDifferentProfiles = report.gates.completeThreeProfiles && report.comparisons.length === 3 && report.comparisons.every(c => c.useful) && report.profiles.every(p => new Set(p.result!.rows.map(r => r.rawAffinity)).size >= 5);
  report.status = Object.values(report.gates).every(Boolean) ? 'PASS' : 'FAIL';
  report.reason = report.status === 'PASS' ? 'Live feasibility gates passed for the explicitly listed mapped candidate universe. Review raw evidence and outstanding mappings before production use.' : 'At least one live feasibility gate failed. Review mappings, unknown values, profile coverage, and errors. Do not claim live feasibility is proven.';
  return report;
}

export type ProbeReport = Awaited<ReturnType<typeof runProbe>>;
/** Explicit projection for sharing. Never spread provider objects, raw JSON, messages, names,
 * entity IDs, request URLs, headers, or arbitrary upstream strings into this summary. */
export function createShareableProbeSummary(report: ProbeReport) {
  const codeAllowlist = new Set(['NOT_CONFIGURED', 'INVALID_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'RATE_LIMITED', 'UPSTREAM', 'TIMEOUT', 'NETWORK', 'INVALID_RESPONSE', 'HARNESS_UNAVAILABLE', 'HARNESS_INCOMPATIBLE', 'HARNESS_CONTRACT', 'PROBE_FAILED', 'UNRESOLVED_INPUTS']);
  const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const flag = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
  const failure = (value: ReturnType<typeof safeFailure>) => ({
    code: codeAllowlist.has(value.code) ? value.code : 'PROBE_FAILED',
    httpStatus: value.httpStatus !== undefined && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : null,
    retryable: flag(value.retryable), attempts: number(value.metadata?.attempts), retryAfterMs: number(value.metadata?.retryAfterMs),
  });
  const failures = [...report.mappings, ...report.seeds, ...report.profiles].flatMap(item => item.failure ? [failure(item.failure)] : []);
  const status = report.status === 'PASS' ? 'PASS' : report.status === 'FAIL' ? 'FAIL' : 'UNVERIFIED';
  const harnessStatus = ['READY', 'MISSING', 'INCOMPATIBLE', 'ERROR', 'NOT_USED'].find(value => value === report.readiness.harness.status) ?? 'ERROR';
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), status,
    notice: 'Shareable technical summary only. No credentials, raw provider payloads, headers or provider messages are included. Rights and fees remain synthetic; affinity is not an attendance forecast.',
    provider: { baseUrl: 'https://hackathon.api.qloo.com', configured: report.provider.configured === true, transport: report.provider.transport === 'harness' ? 'harness' : report.provider.transport === 'direct-http' ? 'direct-http' : 'UNKNOWN' },
    harness: { status: harnessStatus, installedVersion: /^\d+\.\d+\.\d+$/.test(report.readiness.harness.installedVersion ?? '') ? report.readiness.harness.installedVersion : null },
    expectedFilms: 30, expectedCohorts: 3, mappedFilmCount: number(report.mappedFilmCount),
    observed: { filmLookups: report.mappings.length, mappedFilms: report.mappings.filter(item => item.resolution.status === 'mapped').length, seedLookups: report.seeds.length, mappedSeeds: report.seeds.filter(item => item.resolution.status === 'mapped').length, profilesReturned: report.profiles.filter(item => item.result).length },
    gates: { atLeast25Mapped: flag(report.gates.atLeast25Mapped), allSeedsResolved: flag(report.gates.allSeedsResolved), completeThreeProfiles: flag(report.gates.completeThreeProfiles), usefulDifferentProfiles: flag(report.gates.usefulDifferentProfiles) },
    stoppedEarly: report.stoppedEarly ? { stage: ['film-mapping', 'seed-mapping', 'profiles'].find(value => value === report.stoppedEarly?.stage) ?? 'UNKNOWN', failure: failure(report.stoppedEarly.failure) } : null,
    explainability: report.explainabilityChecks.map((item, index) => ({ cohort: index + 1, status: ['UNVERIFIED', 'AVAILABLE', 'UNAVAILABLE'].find(value => value === item.status) ?? 'UNVERIFIED', perEntityReturnedCount: number(item.perEntityReturnedCount), aggregateReturned: flag(item.aggregateReturned) })),
    failures,
  };
}

async function main() {
  const argument = process.argv.indexOf('--overrides');
  const overridePath = argument >= 0 ? process.argv[argument + 1] : undefined;
  if (argument >= 0 && !overridePath) throw new Error('--overrides requires a JSON path');
  const overrides: ProbeOverrides = overridePath ? JSON.parse(await readFile(resolve(overridePath), 'utf8')) : {};
  const client = new QlooClient({ apiKey: process.env.QLOO_API_KEY, baseUrl: process.env.QLOO_BASE_URL, transport: process.env.QLOO_TRANSPORT,
    ...(process.env.QLOO_RETRY_BUDGET_MS ? { retryBudgetMs: Number(process.env.QLOO_RETRY_BUDGET_MS) } : {}),
    ...(process.env.QLOO_TIMEOUT_MS ? { timeoutMs: Number(process.env.QLOO_TIMEOUT_MS) } : {}),
    ...(process.env.QLOO_CACHE_TTL_MS ? { cacheTtlMs: Number(process.env.QLOO_CACHE_TTL_MS) } : {}),
  });
  const report = await runProbe(client, overrides);
  const output = resolve(process.env.QLOO_PROBE_OUTPUT ?? 'reports/qloo-probe.json');
  const summaryOutput = `${output.slice(0, output.length - extname(output).length)}-summary.json`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  await writeFile(summaryOutput, JSON.stringify(createShareableProbeSummary(report), null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ status: report.status, mappedFilmCount: report.mappedFilmCount, gates: report.gates, privateReport: output, shareableSummary: summaryOutput, reason: report.reason, sharing: 'Share only the summary file. Keep the full raw-evidence report local for inspection.' }, null, 2));
  process.exitCode = report.status === 'PASS' ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  console.error(JSON.stringify(safeFailure(error))); process.exitCode = 1;
});
