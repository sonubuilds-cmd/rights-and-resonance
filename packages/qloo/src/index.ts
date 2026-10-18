/** Server-only Qloo boundary. Synthetic demos never pass through this adapter. */
import { createHash } from 'node:crypto';
import { runHarness, QLOO_HARNESS_PACKAGE, QLOO_HARNESS_MINIMUM_VERSION, type HarnessRunner, type HarnessOutput } from './harness';
export { QLOO_HARNESS_PACKAGE, QLOO_HARNESS_MINIMUM_VERSION, type HarnessRunner, type HarnessOutput } from './harness';

if (typeof globalThis === 'object' && 'document' in globalThis) {
  throw new Error('@rr/qloo must only run on the server');
}

/** Local capability check; loading the harness takes ~20s on a 0.1-CPU host, so allow a generous default. */
const READINESS_TIMEOUT_MS = Math.min(Math.max(Number(process.env.QLOO_READINESS_TIMEOUT_MS) || 60_000, 1_000), 120_000);
export const QLOO_DEFAULT_BASE_URL = 'https://hackathon.api.qloo.com';
export const INSIGHTS_PARAMETER_ALLOWLIST = Object.freeze([
  'filter.type', 'signal.interests.entities', 'filter.results.entities', 'feature.explainability', 'take',
] as const);
/** Tag insights (cohort taste DNA) use their own, equally closed, parameter set. */
export const TAG_INSIGHTS_PARAMETER_ALLOWLIST = Object.freeze([
  'filter.type', 'signal.interests.entities', 'filter.tag.types', 'filter.parents.types', 'take',
] as const);
export type QlooErrorCode = 'NOT_CONFIGURED' | 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'RATE_LIMITED' | 'UPSTREAM' | 'TIMEOUT' | 'NETWORK' | 'INVALID_RESPONSE' | 'HARNESS_UNAVAILABLE' | 'HARNESS_INCOMPATIBLE' | 'HARNESS_CONTRACT';
export type QlooTransport = 'harness' | 'direct-http';
export type QlooFailureMetadata = { transport: QlooTransport; baseUrl: string; endpoint: string; requestHash: string; attempts: number; retryAfterMs?: number; retryAt?: string; retryBudgetExceeded?: boolean };
export class QlooError extends Error {
  constructor(public readonly code: QlooErrorCode, message: string, public readonly retryable = false, public readonly httpStatus?: number, public readonly metadata?: Readonly<QlooFailureMetadata>) {
    super(message); this.name = 'QlooError';
  }
}
export type QlooEvidence = {
  source: 'QLOO'; endpoint: '/search' | '/entities' | '/v2/insights'; baseUrl: string;
  requestHash: string; responseHash: string; fetchedAt: string; servedAt: string;
  cache: 'LIVE' | 'FRESH_CACHE' | 'STALE_CACHE'; attempts: number; httpStatus: number;
  candidateUniverseHash?: string;
  transport: QlooTransport; harness?: { package: string; version: string; route: 'qloo api'; command: string; cliExitCode: number };
};
export type QlooEntity = {
  entityId: string; name: string; type: string | null; releaseYear: number | null;
  rawAffinity: number | null; explainability?: unknown; raw: Record<string, unknown>;
};
export type QlooResult = {
  status: 'complete' | 'partial' | 'unknown'; entities: QlooEntity[]; raw: unknown;
  evidence: QlooEvidence; warnings: string[];
};
export type RankedAffinity = { entityId: string; rawAffinity: number | null; percentile: number | null; explainability?: unknown;
  /** True when this film is itself a cohort seed: Qloo never recommends a seed back, so its affinity is unknown (null), never 0. */
  excludedAsSeed?: boolean };
export type QlooInsightsResult = QlooResult & {
  rows: RankedAffinity[]; candidateUniverse: string[]; missingEntityIds: string[]; complete: boolean;
  aggregateExplainability?: unknown;
};
export type QlooTag = { tagId: string; name: string; types: string[]; subtype: string | null; rawAffinity: number | null };
export type QlooTagInsightsResult = { status: 'complete' | 'partial' | 'unknown'; tags: QlooTag[]; raw: unknown; evidence: QlooEvidence; warnings: string[] };
export type TagInsightsRequest = { seedEntityIds: string[]; tagTypes?: string; parentType?: string; take?: number };
export type EntityTag = { id: string; name: string; type: string };
export type InsightsRequest = { seedEntityIds: string[]; candidateEntityIds: string[]; explainability?: boolean; take?: number };
export type QlooClientOptions = {
  apiKey?: string; baseUrl?: string; timeoutMs?: number; maxAttempts?: number; transport?: string; retryBudgetMs?: number;
  harnessRunner?: HarnessRunner;
  cacheTtlMs?: number; staleMaxAgeMs?: number; maxCacheEntries?: number;
  fetchImpl?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>;
};

export type QlooReadiness = {
  configured: boolean; baseUrl: string; transport: QlooTransport; liveVerification: 'UNVERIFIED'; ready: boolean;
  harness: { package: string; minimumVersion: string; installedVersion: string | null; status: 'READY' | 'MISSING' | 'INCOMPATIBLE' | 'ERROR' | 'NOT_USED'; capabilities: string[]; checkedAt: string; message: string };
};
/** HTTP delta-seconds and HTTP-date, never clamped down to an earlier retry. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  if (!value?.trim()) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) { const milliseconds = Number(value) * 1000; return Number.isFinite(milliseconds) ? milliseconds : Number.MAX_SAFE_INTEGER; }
  if (!/[a-z]/i.test(value)) return undefined;
  const date = Date.parse(value); return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
function immutable<T>(value: T): T {
  const pending: unknown[] = [value];
  while (pending.length) { const item = pending.pop(); if (item && typeof item === 'object' && !Object.isFrozen(item)) { for (const child of Object.values(item)) pending.push(child); Object.freeze(item); } }
  return value;
}

type JsonRecord = Record<string, unknown>;
const record = (v: unknown): v is JsonRecord => typeof v === 'object' && v !== null && !Array.isArray(v);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const present = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const score = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
export const hashEvidence = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function invalid(message: string): never { throw new QlooError('INVALID_REQUEST', message); }
function ids(values: string[], label: string): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 50 || values.some(v => typeof v !== 'string' || !uuid.test(v)))
    invalid(`${label} must contain 1–50 verified Qloo UUIDs`);
  const normalized = values.map(v => v.toLowerCase());
  if (new Set(normalized).size !== normalized.length) invalid(`${label} contains duplicate entity IDs`);
  return normalized;
}
function boundedInteger(value: number, low: number, high: number, name: string): number {
  if (!Number.isInteger(value) || value < low || value > high) invalid(`${name} is outside the supported range`);
  return value;
}

/** Parse only explicit supported fields. The original response and entity are always retained. */
export function parseQlooEntities(raw: unknown, endpoint: QlooEvidence['endpoint']): Pick<QlooResult, 'entities' | 'status' | 'warnings'> {
  const warnings: string[] = [];
  // Live /search and /entities (via harness 0.1.26) return a bare {results:[...]} with no `success` key; /v2/insights
  // returns success:true. An explicit success:false, or a non-object, is never accepted.
  if (!record(raw) || raw.success === false || (raw.success !== true && !Array.isArray(raw.results) && !record(raw.results))) return { entities: [], status: 'unknown', warnings: ['Response did not affirm success'] };
  if (raw.success !== true && endpoint === '/v2/insights') return { entities: [], status: 'unknown', warnings: ['Response did not affirm success'] };
  const container = endpoint === '/v2/insights' && record(raw.results) ? raw.results.entities : raw.results;
  if (!Array.isArray(container)) return { entities: [], status: 'unknown', warnings: ['Unrecognized response envelope; inspect retained raw evidence'] };
  const entities: QlooEntity[] = [];
  const seen = new Set<string>();
  for (const item of container) {
    if (!record(item) || !present(item.entity_id) || !uuid.test(item.entity_id) || !present(item.name)) {
      warnings.push('Malformed entity omitted; response is incomplete'); continue;
    }
    const entityId = item.entity_id.toLowerCase();
    if (seen.has(entityId)) { warnings.push('Duplicate entity omitted; response is incomplete'); continue; }
    seen.add(entityId);
    const properties = record(item.properties) ? item.properties : {};
    const query = record(item.query) ? item.query : {};
    const affinity = query.affinity ?? item.affinity;
    const year = properties.release_year ?? item.release_year;
    const types = Array.isArray(item.types) ? item.types.filter((value): value is string => present(value) && value.startsWith('urn:entity:')) : [];
    const type = present(item.subtype) ? item.subtype :
      present(item.type) && item.type.startsWith('urn:entity:') ? item.type :
      types.length === 1 ? types[0]! : null;
    const entity: QlooEntity = {
      entityId, name: item.name, type,
      releaseYear: typeof year === 'number' && Number.isInteger(year) && year >= 1888 && year <= 2100 ? year : null,
      rawAffinity: score(affinity) ? affinity : null, raw: item,
    };
    if (Object.hasOwn(query, 'explainability')) entity.explainability = query.explainability;
    if (endpoint === '/v2/insights' && !score(affinity)) warnings.push('Missing or invalid affinity; value remains unknown');
    entities.push(entity);
  }
  return { entities, status: warnings.length ? 'partial' : 'complete', warnings };
}

/** Parse `/v2/insights?filter.type=urn:tag` → results.tags[]. Only explicit fields; malformed rows are dropped with a warning. */
export function parseQlooTags(raw: unknown): Pick<QlooTagInsightsResult, 'tags' | 'status' | 'warnings'> {
  if (!record(raw) || raw.success !== true || !record(raw.results) || !Array.isArray(raw.results.tags)) return { tags: [], status: 'unknown', warnings: ['Response did not affirm success'] };
  const warnings: string[] = []; const tags: QlooTag[] = []; const seen = new Set<string>();
  for (const item of raw.results.tags) {
    const query = record(item) && record(item.query) ? item.query : {};
    if (!record(item) || !present(item.tag_id) || !present(item.name) || seen.has(item.tag_id)) { warnings.push('Malformed or duplicate tag omitted; response is incomplete'); continue; }
    seen.add(item.tag_id);
    tags.push({ tagId: item.tag_id, name: item.name.trim(), types: Array.isArray(item.types) ? item.types.filter(present) : [], subtype: present(item.subtype) ? item.subtype : null, rawAffinity: score(query.affinity) ? query.affinity : null });
  }
  return { tags, status: warnings.length ? 'partial' : 'complete', warnings };
}
/** Tags carried on a /search or /entities record (`tag_id` live; `id` tolerated). Never invents tags. */
export function extractEntityTags(entity: Pick<QlooEntity, 'raw'>): EntityTag[] {
  const list = entity.raw.tags; if (!Array.isArray(list)) return [];
  const out: EntityTag[] = []; const seen = new Set<string>();
  for (const t of list) {
    if (!record(t)) continue;
    const id = present(t.tag_id) ? t.tag_id : present(t.id) ? t.id : null;
    if (!id || !present(t.name) || seen.has(id)) continue;
    seen.add(id); out.push({ id, name: t.name.trim(), type: present(t.type) ? t.type : id.split(':').slice(0, 4).join(':') });
  }
  return out;
}

/** Midrank percentile, 0 = lowest, 1 = highest, ties share a rank. No partial-universe normalization. */
export function normalizeFixedUniverse(entities: ReadonlyArray<Pick<QlooEntity, 'entityId' | 'rawAffinity' | 'explainability'>>, candidateEntityIds: string[], seedEntityIds: readonly string[] = []): {
  rows: RankedAffinity[]; complete: boolean; missingEntityIds: string[]; candidateUniverse: string[];
} {
  const universe = ids(candidateEntityIds, 'Candidate universe').sort();
  const universeSet = new Set(universe);
  const byId = new Map<string, typeof entities[number]>();
  let invalidRows = false;
  for (const entity of entities) {
    const key = entity.entityId.toLowerCase();
    if (!universeSet.has(key) || byId.has(key)) invalidRows = true;
    else byId.set(key, entity);
  }
  // Observed live: /v2/insights omits the signal (seed) entities from its results. A candidate that is also a seed is
  // therefore expected to be absent; it stays in the universe with null affinity and is excluded from percentile ranking.
  const seedSet = new Set(seedEntityIds.map(id => id.toLowerCase()));
  const missing = universe.filter(id => !score(byId.get(id)?.rawAffinity));
  const missingEntityIds = missing.filter(id => !seedSet.has(id));
  const complete = missingEntityIds.length === 0 && !invalidRows && missing.length < universe.length;
  const values = complete ? universe.filter(id => !missing.includes(id)).map(id => byId.get(id)!.rawAffinity as number).sort((a, b) => a - b) : [];
  const rows = universe.map(entityId => {
    const item = byId.get(entityId);
    const rawAffinity = score(item?.rawAffinity) ? item.rawAffinity : null;
    const percentile = complete && rawAffinity !== null ? values.length === 1 ? 0.5 :
      (values.indexOf(rawAffinity) + values.lastIndexOf(rawAffinity)) / 2 / (values.length - 1) : null;
    return { entityId, rawAffinity, percentile, ...(rawAffinity === null && seedSet.has(entityId) ? { excludedAsSeed: true } : {}), ...(item && Object.hasOwn(item, 'explainability') ? { explainability: item.explainability } : {}) };
  });
  return { rows, complete, missingEntityIds, candidateUniverse: universe };
}

export type MappingResolution = { status: 'mapped' | 'ambiguous' | 'missing'; entityId: string | null; candidates: QlooEntity[]; reason: string };
const normalizeName = (name: string): string => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
/** Only a unique exact normalized title AND release year can automatically map a film. */
export function resolveFilmMapping(title: string, year: number, entities: QlooEntity[]): MappingResolution {
  const candidates = entities.filter(e => e.type === 'urn:entity:movie');
  const named = candidates.filter(e => normalizeName(e.name) === normalizeName(title));
  const exact = named.filter(e => e.releaseYear === year);
  if (exact.length === 1 && !named.some(e => e.releaseYear === null))
    return { status: 'mapped', entityId: exact[0]!.entityId, candidates: exact, reason: 'Unique exact title and release year match' };
  return { status: candidates.length ? 'ambiguous' : 'missing', entityId: null, candidates, reason: candidates.length ? 'Human confirmation required; title/year did not establish a unique match' : 'No movie candidates returned' };
}
export function resolveSeedMapping(name: string, type: string, entities: QlooEntity[]): MappingResolution {
  const candidates = entities.filter(e => e.type === type);
  const exact = candidates.filter(e => normalizeName(e.name) === normalizeName(name));
  if (exact.length === 1) return { status: 'mapped', entityId: exact[0]!.entityId, candidates: exact, reason: 'Unique exact name and type match' };
  return { status: candidates.length ? 'ambiguous' : 'missing', entityId: null, candidates, reason: candidates.length ? 'Human confirmation required; name/type did not establish a unique match' : 'No matching-type candidates returned' };
}

type CachedResponse = { raw: unknown; evidence: QlooEvidence; storedAt: number };
const ALLOWED_HOSTS = new Set(['hackathon.api.qloo.com']);
export class QlooClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #options: Required<Omit<QlooClientOptions, 'apiKey' | 'baseUrl' | 'transport' | 'harnessRunner'>>;
  readonly #transport: QlooTransport;
  readonly #harnessRunner: HarnessRunner;
  #readinessPromise?: Promise<QlooReadiness>;
  readonly #cache = new Map<string, CachedResponse>();
  constructor(options: QlooClientOptions = {}) {
    this.#apiKey = options.apiKey?.trim() ?? '';
    if (options.transport !== undefined && !['harness', 'direct-http'].includes(options.transport)) invalid('QLOO_TRANSPORT must be harness or explicit direct-http compatibility mode');
    this.#transport = (options.transport ?? 'harness') as QlooTransport;
    this.#harnessRunner = options.harnessRunner ?? runHarness;
    if (options.fetchImpl && this.#transport !== 'direct-http') invalid('fetchImpl requires explicit direct-http transport; it cannot replace the official harness');
    let base: URL;
    try { base = new URL(options.baseUrl ?? QLOO_DEFAULT_BASE_URL); } catch { invalid('Qloo base URL is invalid'); }
    if (base.protocol !== 'https:' || !ALLOWED_HOSTS.has(base.hostname) || base.port || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname))
      invalid('Hackathon credentials may only use https://hackathon.api.qloo.com');
    this.#baseUrl = base.origin;
    this.#options = {
      timeoutMs: boundedInteger(options.timeoutMs ?? 10_000, 1, 30_000, 'timeoutMs'),
      maxAttempts: boundedInteger(options.maxAttempts ?? 3, 1, 3, 'maxAttempts'),
      retryBudgetMs: boundedInteger(options.retryBudgetMs ?? 5000, 0, 30_000, 'retryBudgetMs'),
      cacheTtlMs: boundedInteger(options.cacheTtlMs ?? 900_000, 0, 86_400_000, 'cacheTtlMs'),
      staleMaxAgeMs: boundedInteger(options.staleMaxAgeMs ?? 86_400_000, 0, 604_800_000, 'staleMaxAgeMs'),
      maxCacheEntries: boundedInteger(options.maxCacheEntries ?? 100, 1, 1000, 'maxCacheEntries'),
      fetchImpl: options.fetchImpl ?? fetch, now: options.now ?? Date.now,
      sleep: options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))),
    };
  }
  status(): { configured: boolean; baseUrl: string; transport: QlooTransport } { return { configured: !!this.#apiKey, baseUrl: this.#baseUrl, transport: this.#transport }; }
  /** Local-only, memoized capability inspection. It never claims credential/provider verification. */
  readiness(): Promise<QlooReadiness> {
    const pending = this.#readinessPromise ??= (async () => {
      const harness: QlooReadiness['harness'] = { package: QLOO_HARNESS_PACKAGE, minimumVersion: QLOO_HARNESS_MINIMUM_VERSION, installedVersion: null, status: 'NOT_USED', capabilities: [], checkedAt: new Date(this.#options.now()).toISOString(), message: 'Explicit direct HTTP compatibility mode; official harness is not used' };
      if (this.#transport === 'harness') {
        let result: HarnessOutput;
        try { result = await this.#harnessRunner({ action: 'capabilities' }, { timeoutMs: READINESS_TIMEOUT_MS }); }
        catch { result = { ok: false, code: 'CONTRACT' }; }
        harness.installedVersion = result.version ?? null;
        if (result.ok && result.networkCalls === 0 && ['api search', 'api entity', 'api insights'].every(c => result.capabilities?.includes(c))) {
          harness.status = 'READY'; harness.capabilities = result.capabilities!; harness.message = 'Installed official harness version and required CLI capabilities checked locally; live access remains unverified';
        } else { harness.status = !result.ok && result.code === 'MISSING' ? 'MISSING' : !result.ok && result.code === 'INCOMPATIBLE' ? 'INCOMPATIBLE' : 'ERROR'; harness.message = 'Official harness local capability check failed; no direct HTTP fallback was attempted'; }
      }
      return immutable({ ...this.status(), liveVerification: 'UNVERIFIED' as const, ready: !!this.#apiKey && ['READY', 'NOT_USED'].includes(harness.status), harness });
    })();
    // A failed check (e.g. a cold start on a tiny CPU) is retried on the next call instead of sticking until restart.
    void pending.then(result => { if (result.harness.status === 'ERROR' && this.#readinessPromise === pending) this.#readinessPromise = undefined; });
    return pending;
  }
  clearCache(): void { this.#cache.clear(); }
  async search(query: string, options: { take?: number; type?: string } = {}): Promise<QlooResult> {
    if (!present(query) || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)) invalid('Search query must be 1–200 characters');
    const take = boundedInteger(options.take ?? 10, 1, 50, 'take');
    if (options.type && !/^urn:entity:(movie|artist|book|place|brand|tv_show|podcast|person|videogame|actor|album|author|director|locality)$/.test(options.type)) invalid('Unsupported search type');
    return immutable(await this.#parsed('/search', { query: query.trim(), take: String(take), ...(options.type ? { types: options.type } : {}) }));
  }
  async entities(entityIds: string[]): Promise<QlooResult> {
    const expected = ids(entityIds, 'Entity IDs');
    const result = await this.#parsed('/entities', { entity_ids: expected.join(',') });
    if (result.status === 'complete' && (result.entities.length !== expected.length || result.entities.some(e => !expected.includes(e.entityId)))) {
      result.status = 'partial'; result.warnings.push('Entity lookup did not return the exact requested set');
    }
    return immutable(result);
  }
  async insights(request: InsightsRequest): Promise<QlooInsightsResult> {
    if (!record(request) || Object.keys(request).some(k => !['seedEntityIds', 'candidateEntityIds', 'explainability', 'take'].includes(k))) invalid('Unsupported Insights request option');
    const seeds = ids(request.seedEntityIds, 'Seed entities').sort();
    const universe = ids(request.candidateEntityIds, 'Candidate universe').sort();
    const take = boundedInteger(request.take ?? universe.length, 1, 50, 'take');
    if (take < universe.length) invalid('take must cover the entire fixed candidate universe');
    if (request.explainability !== undefined && typeof request.explainability !== 'boolean') invalid('explainability must be boolean');
    const result = await this.#parsed('/v2/insights', {
      'filter.type': 'urn:entity:movie', 'signal.interests.entities': seeds.join(','),
      'filter.results.entities': universe.join(','), 'feature.explainability': String(request.explainability ?? true), take: String(take),
    });
    result.evidence.candidateUniverseHash = hashEvidence(universe);
    const valid = result.entities.filter(e => e.type === 'urn:entity:movie');
    const ranked = normalizeFixedUniverse(valid, universe, seeds);
    const complete = result.status === 'complete' && valid.length === result.entities.length && ranked.complete;
    if (!complete) {
      ranked.rows.forEach(row => { row.percentile = null; });
      if (result.status !== 'unknown') result.status = 'partial';
      result.warnings.push('Incomplete fixed-universe evidence; all normalized percentiles withheld');
    }
    const query = record(result.raw) && record(result.raw.query) ? result.raw.query : undefined;
    if (request.explainability !== false && !result.entities.some(e => Object.hasOwn(e, 'explainability')))
      result.warnings.push('Per-entity explainability was not returned; none is inferred');
    return immutable({ ...result, ...ranked, complete, ...(query && Object.hasOwn(query, 'explainability') ? { aggregateExplainability: query.explainability } : {}) });
  }
  /** Cohort taste DNA: tags a seed set leans towards. Seeds may be any domain; results are tag rows, not entities. */
  async tagInsights(request: TagInsightsRequest): Promise<QlooTagInsightsResult> {
    if (!record(request) || Object.keys(request).some(k => !['seedEntityIds', 'tagTypes', 'parentType', 'take'].includes(k))) invalid('Unsupported tag Insights request option');
    const seeds = ids(request.seedEntityIds, 'Seed entities').sort();
    const take = boundedInteger(request.take ?? 50, 1, 50, 'take');
    if (request.tagTypes !== undefined && !/^urn:tag:[a-z_]+:[a-z_]+$/.test(request.tagTypes)) invalid('Unsupported tag type');
    if (request.parentType !== undefined && !/^urn:entity:[a-z_]+$/.test(request.parentType)) invalid('Unsupported parent entity type');
    const params: Record<string, string> = { 'filter.type': 'urn:tag', 'signal.interests.entities': seeds.join(','), take: String(take),
      ...(request.tagTypes ? { 'filter.tag.types': request.tagTypes } : {}), ...(request.parentType ? { 'filter.parents.types': request.parentType } : {}) };
    const result = await this.#request('/v2/insights', params, raw => { const p = parseQlooTags(raw); return p.status === 'complete' && p.tags.length > 0; });
    const parsed = parseQlooTags(result.raw);
    if (result.evidence.cache === 'STALE_CACHE') parsed.warnings.push('Historical cached evidence after transient provider failure; not a fresh observation');
    return immutable({ ...result, ...parsed });
  }
  async #parsed(endpoint: QlooEvidence['endpoint'], params: Record<string, string>): Promise<QlooResult> {
    const result = await this.#request(endpoint, params);
    const parsed = parseQlooEntities(result.raw, endpoint);
    if (result.evidence.cache === 'STALE_CACHE') parsed.warnings.push('Historical cached evidence after transient provider failure; not a fresh observation');
    return { ...result, ...parsed };
  }
  async #request(endpoint: QlooEvidence['endpoint'], params: Record<string, string>, cacheable?: (raw: unknown) => boolean): Promise<{ raw: unknown; evidence: QlooEvidence }> {
    const url = new URL(endpoint, this.#baseUrl);
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).forEach(([key, value]) => url.searchParams.set(key, value));
    const requestHash = hashEvidence({ method: 'GET', url: url.toString() });
    if (!this.#apiKey) throw new QlooError('NOT_CONFIGURED', 'Qloo is not configured; live feasibility is unverified', false, undefined, immutable({ transport: this.#transport, baseUrl: this.#baseUrl, endpoint, requestHash, attempts: 0 }));
    const cached = this.#cache.get(requestHash);
    const age = cached ? this.#options.now() - cached.storedAt : Infinity;
    if (cached && age >= 0 && age < this.#options.cacheTtlMs) return {
      raw: structuredClone(cached.raw), evidence: { ...structuredClone(cached.evidence), servedAt: new Date(this.#options.now()).toISOString(), cache: 'FRESH_CACHE', attempts: 0 },
    };
    let lastError = new QlooError('NETWORK', 'Qloo request failed', true);
    let waitedMs = 0, attempts = 0;
    for (let attempt = 1; attempt <= this.#options.maxAttempts; attempt++) {
      attempts = attempt;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let providerRetryAfter: number | undefined;
      try {
        const operation = async (): Promise<{ text: string; httpStatus: number; harness?: QlooEvidence['harness'] }> => {
          let text: string, httpStatus: number, retryAfter: string | null;
          let harness: QlooEvidence['harness'];
          if (this.#transport === 'harness') {
            const result = await this.#harnessRunner({ action: 'request', url: url.toString() }, { apiKey: this.#apiKey, timeoutMs: this.#options.timeoutMs });
            if (!result.ok) {
              if (result.code === 'TIMEOUT') throw new QlooError('TIMEOUT', 'Official Qloo harness request timed out', true);
              if (result.code === 'NETWORK') throw new QlooError('NETWORK', 'Official Qloo harness network request failed', true);
              if (result.code === 'MISSING') throw new QlooError('HARNESS_UNAVAILABLE', 'Official Qloo harness is unavailable; install the pinned dependency');
              if (result.code === 'INCOMPATIBLE') throw new QlooError('HARNESS_INCOMPATIBLE', 'Official Qloo harness version is incompatible');
              throw new QlooError('HARNESS_CONTRACT', 'Official Qloo harness failed the bounded request contract; no fallback attempted');
            }
            if (typeof result.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(result.version) || !Number.isInteger(result.httpStatus) || result.httpStatus! < 100 || result.httpStatus! > 599 || typeof result.text !== 'string' || !result.command || !Number.isInteger(result.cliExitCode)) throw new QlooError('HARNESS_CONTRACT', 'Official Qloo harness returned incomplete transport metadata');
            text = result.text; httpStatus = result.httpStatus!; retryAfter = result.retryAfter ?? null;
            harness = { package: QLOO_HARNESS_PACKAGE, version: result.version, route: 'qloo api', command: result.command, cliExitCode: result.cliExitCode! };
          } else {
            const response = await this.#options.fetchImpl(url, { method: 'GET', headers: { 'X-Api-Key': this.#apiKey, Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
            if (response.redirected) throw new QlooError('INVALID_RESPONSE', 'Qloo redirect refused');
            httpStatus = response.status; retryAfter = response.headers.get('retry-after'); text = '';
            if (!response.ok) await response.body?.cancel();
            else {
              const reader = response.body?.getReader();
              if (reader) {
                const decoder = new TextDecoder(); let bytes = 0;
                while (true) {
                  const chunk = await reader.read(); if (chunk.done) break;
                  bytes += chunk.value.byteLength;
                  if (bytes > 4_000_000) { await reader.cancel(); throw new QlooError('INVALID_RESPONSE', 'Qloo response exceeds the safety size limit'); }
                  text += decoder.decode(chunk.value, { stream: true });
                }
                text += decoder.decode();
              }
            }
          }
          providerRetryAfter = parseRetryAfter(retryAfter, this.#options.now());
          if (httpStatus < 200 || httpStatus >= 300) {
            if (httpStatus === 401) throw new QlooError('UNAUTHORIZED', 'Qloo rejected the API credentials; verify the matching API environment', false, 401);
            if (httpStatus === 403) throw new QlooError('FORBIDDEN', 'Qloo denied access to this resource', false, 403);
            if (httpStatus === 404) throw new QlooError('NOT_FOUND', 'Qloo returned no matching resource', false, 404);
            if (httpStatus === 429) throw new QlooError('RATE_LIMITED', 'Qloo rate limit reached', true, 429);
            throw new QlooError('UPSTREAM', 'Qloo returned an unsuccessful response', httpStatus >= 500, httpStatus);
          }
          if (Buffer.byteLength(text) > 4_000_000 || text.includes(this.#apiKey)) throw new QlooError('INVALID_RESPONSE', 'Qloo response failed the safety boundary');
          return { text, httpStatus, ...(harness ? { harness } : {}) };
        };
        const response = await Promise.race([
          operation(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new QlooError('TIMEOUT', 'Qloo request timed out', true)); }, this.#options.timeoutMs); }),
        ]);
        let raw: unknown;
        try { raw = JSON.parse(response.text); } catch { throw new QlooError('INVALID_RESPONSE', 'Qloo returned invalid JSON'); }
        // JSON escapes can hide an echoed credential from the wire-text guard.
        if (JSON.stringify(raw).includes(this.#apiKey)) throw new QlooError('INVALID_RESPONSE', 'Qloo response failed the safety boundary');
        const timestamp = new Date(this.#options.now()).toISOString();
        const evidence: QlooEvidence = { source: 'QLOO', endpoint, baseUrl: this.#baseUrl, requestHash, responseHash: hashEvidence(raw), fetchedAt: timestamp, servedAt: timestamp, cache: 'LIVE', attempts: attempt, httpStatus: response.httpStatus, transport: this.#transport, ...(response.harness ? { harness: response.harness } : {}) };
        if (cacheable ? cacheable(raw) : parseQlooEntities(raw, endpoint).status === 'complete') {
          if (this.#cache.size >= this.#options.maxCacheEntries) this.#cache.delete(this.#cache.keys().next().value!);
          this.#cache.set(requestHash, { raw: structuredClone(raw), evidence: structuredClone(evidence), storedAt: this.#options.now() });
        }
        return { raw, evidence };
      } catch (error) {
        const safe = error instanceof QlooError ? error : new QlooError('NETWORK', 'Qloo network request failed', true);
        const retryBudgetExceeded = providerRetryAfter !== undefined && providerRetryAfter > this.#options.retryBudgetMs - waitedMs;
        const retryTime = providerRetryAfter === undefined ? undefined : this.#options.now() + providerRetryAfter;
        lastError = new QlooError(safe.code, safe.message, safe.retryable, safe.httpStatus, immutable({ transport: this.#transport, baseUrl: this.#baseUrl, endpoint, requestHash, attempts: attempt,
          ...(providerRetryAfter !== undefined ? { retryAfterMs: providerRetryAfter, ...(retryTime! <= 8.64e15 ? { retryAt: new Date(retryTime!).toISOString() } : {}), retryBudgetExceeded } : {}),
        }));
        if (!lastError.retryable || retryBudgetExceeded) throw lastError;
      } finally { if (timer) clearTimeout(timer); controller.abort(); }
      const delay = Math.max(providerRetryAfter ?? 0, 250 * 2 ** (attempt - 1));
      if (attempt < this.#options.maxAttempts) {
        if (waitedMs + delay > this.#options.retryBudgetMs) break;
        await this.#options.sleep(delay); waitedMs += delay;
      }
    }
    if (cached && this.#options.now() - cached.storedAt >= 0 && this.#options.now() - cached.storedAt <= this.#options.staleMaxAgeMs) return {
      raw: structuredClone(cached.raw), evidence: { ...structuredClone(cached.evidence), servedAt: new Date(this.#options.now()).toISOString(), cache: 'STALE_CACHE', attempts },
    };
    throw lastError;
  }
}
