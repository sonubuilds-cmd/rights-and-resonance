import { readFileSync } from 'node:fs';
import { markLiveVerified } from './live-status.js';
import { createDemoData, type TasteProfile, type TasteTag } from '@rr/domain';
import { QlooClient, QlooError, extractEntityTags, type EntityTag, type QlooEvidence, type QlooTag } from '@rr/qloo';

/** Only Qloo theme tags are used for taste DNA: human readable, cross-domain, and shared by films and books/music/games. */
export const THEME_TAG_TYPE = 'urn:tag:theme:qloo';
const FILM_FALLBACK_TYPES = ['urn:tag:plot:qloo', 'urn:tag:subgenre:qloo', 'urn:tag:genre:qloo'];
export const COHORT_DISPLAY_TAGS = 8;
export const FILM_DISPLAY_TAGS = 6;

export type CohortRank = { rank: number; of: number } | null;
export interface LiveTasteInput {
  generatedAt: string;
  cohorts: Array<{ id: string; name: string }>;
  films: Array<{ id: string; title: string }>;
  /** Full Qloo tag pool per cohort (null = request failed), sorted as Qloo returned it. */
  cohortPools: Map<string, QlooTag[] | null>;
  /** Tags on each film's Qloo entity record (null = film record unavailable). */
  filmRecords: Map<string, EntityTag[] | null>;
  /** 1 = highest Qloo affinity among ranked films; null = unknown (seed film, or ranking unavailable). */
  ranks: Map<string, Map<string, CohortRank>>;
  workflow: string[];
  warnings: string[];
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const joinNames = (names: string[]) => names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
const clean = (name: string) => name.trim().replace(/\s+/g, ' ');

/** Relative 0..1 within the returned pool (min-max). Qloo affinities are tightly clustered near 1, so raw values would all look identical. */
export function normalizePool(pool: QlooTag[]): Map<string, number> {
  const values = pool.map(t => t.rawAffinity).filter((v): v is number => v !== null);
  const hi = Math.max(...values), lo = Math.min(...values);
  return new Map(pool.filter(t => t.rawAffinity !== null).map(t => [t.tagId, hi === lo ? 1 : round((t.rawAffinity! - lo) / (hi - lo))]));
}

/** Pure, deterministic and side-effect free: every output string comes from real tag names, ranks or fixed templates. */
export function buildLiveTasteProfile(input: LiveTasteInput): TasteProfile {
  const notes = [...input.warnings];
  const weights = new Map<string, Map<string, number>>();
  const cohorts = input.cohorts.map(c => {
    const pool = input.cohortPools.get(c.id) ?? null;
    if (!pool?.length) { notes.push(`No Qloo tag insights for ${c.name}.`); return { cohortId: c.id, tags: [] as TasteTag[] }; }
    const w = normalizePool(pool); weights.set(c.id, w);
    const tags = pool.filter(t => w.has(t.tagId)).sort((a, b) => w.get(b.tagId)! - w.get(a.tagId)! || a.tagId.localeCompare(b.tagId))
      .slice(0, COHORT_DISPLAY_TAGS).map(t => ({ id: t.tagId, name: clean(t.name), weight: w.get(t.tagId)! }));
    if (tags.length < COHORT_DISPLAY_TAGS) notes.push(`${c.name} returned only ${tags.length} Qloo theme tags.`);
    return { cohortId: c.id, tags };
  });
  const cohortName = new Map(input.cohorts.map(c => [c.id, c.name]));
  const maxWeight = (tagId: string) => Math.max(0, ...[...weights.values()].map(w => w.get(tagId) ?? 0));

  const films = input.films.map(film => {
    const record = input.filmRecords.get(film.id) ?? null;
    if (!record) { notes.push(`No Qloo record for ${film.title}.`); return { filmId: film.id, tags: [] as TasteTag[], sharedTags: [], why: 'Qloo returned no record for this film, so no taste evidence is shown.' }; }
    const themes = record.filter(t => t.type === THEME_TAG_TYPE);
    const fallback = themes.length >= 3 ? [] : FILM_FALLBACK_TYPES.flatMap(type => record.filter(t => t.type === type));
    // Shared-with-a-cohort tags first (strongest first), then the rest in Qloo's own record order. Weight is the
    // strongest cohort affinity observed for that tag; 0 means "no cohort signal", not "unimportant".
    const ordered = [...themes, ...fallback].map((t, i) => ({ t, i, w: maxWeight(t.id) }))
      .sort((a, b) => (b.w > 0 ? 1 : 0) - (a.w > 0 ? 1 : 0) || b.w - a.w || a.i - b.i).slice(0, FILM_DISPLAY_TAGS);
    const tags = ordered.map(({ t, w }) => ({ id: t.id, name: clean(t.name), weight: w }));
    const rankIn = (cohortId: string) => input.ranks.get(cohortId)?.get(film.id) ?? null;
    // Lead cohort = the sharing cohort where Qloo ranks the film best (unranked last), then strongest tag overlap.
    const relRank = (cohortId: string) => { const r = rankIn(cohortId); return r ? r.rank / r.of : 2; };
    const shared = input.cohorts.map(c => {
      const own = weights.get(c.id);
      const tagIds = own ? tags.filter(t => own.has(t.id)).map(t => t.id) : [];
      return { cohortId: c.id, tagIds, score: tagIds.reduce((s, id) => s + own!.get(id)!, 0) };
    }).filter(s => s.tagIds.length > 0).sort((a, b) => relRank(a.cohortId) - relRank(b.cohortId) || b.score - a.score || a.cohortId.localeCompare(b.cohortId));
    const lead = shared[0];
    let why: string;
    if (lead) {
      const names = lead.tagIds.slice(0, 3).map(id => `'${tags.find(t => t.id === id)!.name.toLowerCase()}'`);
      const r = rankIn(lead.cohortId);
      const others = shared.length - 1;
      why = `Shares the Qloo themes ${joinNames(names)} with ${cohortName.get(lead.cohortId)}${r ? `, where Qloo ranks it #${r.rank} of ${r.of} candidate films` : ''}${others > 0 ? `; also overlaps with ${others} other cohort${others > 1 ? 's' : ''}` : ''}.`;
    } else {
      const ranked = input.cohorts.map(c => ({ c, r: rankIn(c.id) })).filter((x): x is { c: typeof x.c; r: NonNullable<CohortRank> } => x.r !== null)
        .sort((a, b) => a.r.rank / a.r.of - b.r.rank / b.r.of || a.c.id.localeCompare(b.c.id))[0];
      why = ranked
        ? `No Qloo theme overlap with any cohort's top themes; Qloo ranks it #${ranked.r.rank} of ${ranked.r.of} candidate films for ${ranked.c.name}, its strongest cohort.`
        : 'No Qloo theme overlap with any cohort, and no cohort ranking is available for this film.';
    }
    return { filmId: film.id, tags, sharedTags: shared.map(({ cohortId, tagIds }) => ({ cohortId, tagIds })), why };
  });

  const nothing = cohorts.every(c => c.tags.length === 0) && films.every(f => f.tags.length === 0);
  const complete = !nothing && notes.length === 0;
  const base = 'Live Qloo taste signals: tags are relative group tendencies, not attendance predictions.';
  return {
    source: 'QLOO_LIVE', generatedAt: input.generatedAt, workflow: input.workflow, cohorts, films,
    status: nothing ? 'unavailable' : complete ? 'ok' : 'partial',
    message: complete ? base : `${base} ${[...new Set(notes)].slice(0, 6).join(' ')}`,
  };
}

type Mappings = { films: Record<string, string>; seeds: Record<string, string> };
let mappingsCache: Mappings | undefined;
export function loadResolvedMappings(): Mappings {
  return mappingsCache ??= JSON.parse(readFileSync(new URL('../../../packages/qloo/fixtures/resolved-mappings.json', import.meta.url), 'utf8')) as Mappings;
}

export interface LiveTasteOptions { client: () => QlooClient; cacheTtlMs?: number; failureTtlMs?: number; now?: () => number; mappings?: Mappings }

/** Server-only. Reads Qloo through the pinned adapter; never fabricates values. Result cached in-process. */
export class LiveQlooTasteSource {
  #cached?: { at: number; profile: TasteProfile };
  #inflight?: Promise<TasteProfile>;
  constructor(private readonly options: LiveTasteOptions) {}
  async load(): Promise<TasteProfile> {
    const clock = this.options.now ?? Date.now;
    const ttl = this.#cached?.profile.status === 'unavailable' ? (this.options.failureTtlMs ?? 30_000) : (this.options.cacheTtlMs ?? 900_000);
    if (!this.#cached || clock() - this.#cached.at >= ttl) {
      this.#inflight ??= this.#build().then(profile => { this.#cached = { at: clock(), profile }; return profile; }).finally(() => { this.#inflight = undefined; });
      await this.#inflight;
    }
    return structuredClone(this.#cached!.profile);
  }
  async #build(): Promise<TasteProfile> {
    const generatedAt = new Date((this.options.now ?? Date.now)()).toISOString();
    const unavailable = (message: string, workflow: string[] = []): TasteProfile => ({ source: 'QLOO_LIVE', generatedAt, workflow, cohorts: [], films: [], status: 'unavailable', message });
    let client: QlooClient;
    try { client = this.options.client(); } catch { return unavailable('The live Qloo client could not be configured. No live data is shown.'); }
    if (!client.status().configured) return unavailable('QLOO_API_KEY is not configured on the server. No live data is shown.');
    const demo = createDemoData();
    let mappings: Mappings;
    try { mappings = this.options.mappings ?? loadResolvedMappings(); } catch { return unavailable('The resolved Qloo mapping fixture could not be read. No live data is shown.'); }
    const filmIds = demo.films.map(f => mappings.films[f.id]?.toLowerCase());
    const films = demo.films.filter((_, i) => filmIds[i]);
    const entityOf = new Map(films.map(f => [f.id, mappings.films[f.id]!.toLowerCase()]));
    const warnings: string[] = []; const workflow: string[] = []; const evidence: QlooEvidence[] = [];
    if (films.length < demo.films.length) warnings.push(`${demo.films.length - films.length} films have no confirmed Qloo mapping and are shown without taste data.`);
    const filmRecords = new Map<string, EntityTag[] | null>(demo.films.map(f => [f.id, null]));
    const cohortPools = new Map<string, QlooTag[] | null>(); const ranks = new Map<string, Map<string, CohortRank>>();
    try {
      const res = await client.entities([...entityOf.values()]); evidence.push(res.evidence); workflow.push(`qloo api /entities (${entityOf.size} mapped films)`);
      if (res.status !== 'complete') warnings.push('Qloo film records were incomplete.');
      if (res.evidence.cache === 'STALE_CACHE') warnings.push('Film records come from a stale cache after a provider failure.');
      const byEntity = new Map(res.entities.map(e => [e.entityId, extractEntityTags(e)]));
      for (const [filmId, entityId] of entityOf) filmRecords.set(filmId, byEntity.get(entityId) ?? null);
    } catch (error) { warnings.push(`Qloo film lookup failed (${error instanceof QlooError ? error.code : 'ERROR'}).`); workflow.push('qloo api /entities (failed)'); }
    const allEntities = [...entityOf.values()];
    for (const cohort of demo.cohorts) {
      const seedIds = [...new Set(cohort.seeds.map(s => mappings.seeds[`${cohort.id}:${s.name}`]?.toLowerCase()).filter((v): v is string => !!v))];
      if (seedIds.length !== cohort.seeds.length) { warnings.push(`${cohort.name} has unresolved seeds.`); }
      if (!seedIds.length) { cohortPools.set(cohort.id, null); continue; }
      try {
        const res = await client.tagInsights({ seedEntityIds: seedIds, tagTypes: THEME_TAG_TYPE, parentType: 'urn:entity:movie', take: 50 });
        evidence.push(res.evidence);
        if (res.status !== 'complete' || res.evidence.cache === 'STALE_CACHE') warnings.push(`${cohort.name} tag insights were incomplete or stale.`);
        cohortPools.set(cohort.id, res.tags);
      } catch (error) { cohortPools.set(cohort.id, null); warnings.push(`${cohort.name} tag insights failed (${error instanceof QlooError ? error.code : 'ERROR'}).`); }
      if (allEntities.length >= 2) {
        try {
          const res = await client.insights({ seedEntityIds: seedIds, candidateEntityIds: allEntities, explainability: true });
          evidence.push(res.evidence);
          const ranked = res.rows.filter(r => r.rawAffinity !== null).sort((a, b) => b.rawAffinity! - a.rawAffinity! || a.entityId.localeCompare(b.entityId));
          const m = new Map<string, CohortRank>();
          for (const [filmId, entityId] of entityOf) { const i = ranked.findIndex(r => r.entityId === entityId); m.set(filmId, i < 0 ? null : { rank: i + 1, of: ranked.length }); }
          ranks.set(cohort.id, m);
          if (!res.complete) warnings.push(`${cohort.name} film ranking was incomplete.`);
        } catch (error) { warnings.push(`${cohort.name} film ranking failed (${error instanceof QlooError ? error.code : 'ERROR'}).`); }
      }
    }
    if (evidence.length && evidence.some(e => e.cache === 'LIVE') && !evidence.some(e => e.cache === 'STALE_CACHE')) markLiveVerified('TASTE');
    const cached = evidence.filter(e => e.cache !== 'LIVE').length;
    workflow.push(`qloo api /v2/insights (urn:tag, ${THEME_TAG_TYPE}, ${demo.cohorts.length} cohorts)`, `qloo api /v2/insights (urn:entity:movie fixed universe, ${demo.cohorts.length} cohort ranks)`,
      'local: tag-id intersection of film and cohort tags; deterministic template sentence (no LLM)');
    if (cached) workflow.push(`${cached} of ${evidence.length} Qloo responses served from the in-process cache`);
    return buildLiveTasteProfile({ generatedAt, cohorts: demo.cohorts.map(c => ({ id: c.id, name: c.name })), films: demo.films.map(f => ({ id: f.id, title: f.title })), cohortPools, filmRecords, ranks, workflow, warnings });
  }
}
