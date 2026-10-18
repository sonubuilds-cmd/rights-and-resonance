/**
 * Transport-agnostic agent tool layer.
 *
 * One registry, many front doors: the MCP server (mcp-server.ts: Streamable HTTP at /mcp and stdio) and the
 * future in-app Gemini agent both call `invokeAgentTool` / `agentTools`. Tools call the same internal workflow
 * and state-transition functions as the REST routes (never HTTP), against the workspace named by `ctx.sessionId`.
 *
 * Invariants an agent cannot bypass: the deterministic solver alone chooses programmes; approval is a separate,
 * explicit human decision; rights and fees are synthetic; Qloo affinities are never attendance forecasts;
 * the Qloo API key never appears in any tool result.
 */
import { z } from 'zod/v4';
import { filmEligibility } from '@rr/solver';
import type { Film, TasteProfile } from '@rr/domain';
import type { StateStore } from './store.js';
import type { TasteDnaSource } from './taste.js';
import type { AppState, EvidenceSnapshot, ProgrammeVersion } from './types.js';
import { defaultEvidenceMode } from './state.js';
import { generateProgramme, currentViolations } from './workflow.js';
import { ApiError, approveVersion, findVersion, getFilm, revokeRights, rightsEnquiryText } from './operations.js';
import { qloo } from './evidence.js';
import { liveVerification } from './live-status.js';

/** What a tool needs to run: which workspace, where state lives, and where taste data comes from. */
export interface AgentToolContext {
  /** Key of the workspace in `store`. MCP: one per MCP session. Web chat: the browser's rr_session id. */
  sessionId: string;
  store: StateStore;
  taste: TasteDnaSource;
}
/** `data` is structured JSON for the model/UI; `summary` is a concise human-readable recap. */
export interface AgentToolResult { data: unknown; summary: string }
export interface AgentToolAnnotations { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  /** Written for an LLM: when to call it, what it returns, what to confirm with the user first. */
  description: string;
  inputSchema: S;
  annotations: AgentToolAnnotations;
  run(ctx: AgentToolContext, input: z.output<S>): Promise<AgentToolResult>;
}
/** Expected, model-readable failure (bad id, blocked generation, stale draft...). Message is safe to show an agent. */
export class AgentToolError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) { super(message); this.name = 'AgentToolError'; }
}
export type AgentToolOutcome =
  | ({ ok: true; tool: string } & AgentToolResult)
  | { ok: false; tool: string; error: { code: string; message: string; details?: unknown } };

const defineTool = <S extends z.ZodType>(tool: AgentTool<S>): AgentTool => tool as unknown as AgentTool;

// ---------- helpers ----------
const idSchema = z.string().min(1).max(120);
const money = (pence: number) => `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;
const r2 = (n: number | null | undefined) => n == null ? null : Math.round(n * 100) / 100;
const latestVersion = (s: AppState) => s.versions.at(-1);
const slotLabel = (s: AppState, slotId: string) => s.slots.find(x => x.id === slotId)?.label ?? slotId;

async function readState(ctx: AgentToolContext) { return ctx.store.read(ctx.sessionId); }
async function loadTaste(ctx: AgentToolContext): Promise<TasteProfile | null> {
  try { return await ctx.taste.load(); } catch { return null; }
}
const usableTaste = (t: TasteProfile | null) => t && t.status !== 'unavailable' ? t : null;

function latestEvidence(s: AppState, version?: ProgrammeVersion): EvidenceSnapshot | undefined {
  if (version) return s.evidence.find(e => e.id === version.evidenceId);
  return [...s.evidence].reverse().find(e => e.status === 'COMPLETE' && e.mode === s.evidenceMode);
}
const evidenceLabel = (e?: EvidenceSnapshot) => !e ? 'DEMO_FIXTURE (synthetic)' : e.mode === 'DEMO' ? 'SYNTHETIC_DEMO' : e.mode === 'QLOO' ? 'QLOO_LIVE_API' : e.mode;

function rightsView(f: Film) {
  return { available: f.rights.available, territory: f.rights.territory, from: f.rights.availableFrom, to: f.rights.availableTo, feePence: f.rights.feePence, fee: money(f.rights.feePence), source: f.rights.source, note: 'SYNTHETIC illustrative rights; not real clearance.' };
}

/** Per-cohort fit of one film against one evidence snapshot: rank-percentile, rank among candidates, seed-film handling. */
function cohortFit(s: AppState, filmId: string, evidence?: EvidenceSnapshot) {
  const matrix = evidence?.normalizedAffinities ?? s.affinities;
  return s.cohorts.map(c => {
    const row = matrix[c.id] ?? {};
    const score = row[filmId] ?? null;
    const seed = evidence?.seedExcluded?.[c.id]?.includes(filmId) ?? false;
    const scored = Object.values(row).filter((v): v is number => typeof v === 'number');
    const rank = score == null ? null : 1 + scored.filter(v => v > score).length;
    return {
      cohortId: c.id, cohort: c.name, score: r2(score), rank, of: scored.length,
      status: seed ? 'SEED_FILM_UNSCORED' : score == null ? 'UNKNOWN' : 'RANKED',
      ...(seed ? { note: "This film is itself a seed for the cohort; Qloo does not score a seed against itself, so it is unknown (never zero) for this cohort and skipped in its coverage." } : {}),
    };
  });
}

function themesFor(taste: TasteProfile | null, s: AppState, filmId: string) {
  const entry = taste?.films.find(f => f.filmId === filmId);
  if (!entry) return null;
  const cohortName = (id: string) => s.cohorts.find(c => c.id === id)?.name ?? id;
  const tagName = (id: string) => entry.tags.find(t => t.id === id)?.name ?? id;
  return {
    why: entry.why, themes: entry.tags.map(t => t.name),
    sharedWithCohorts: entry.sharedTags.map(x => ({ cohortId: x.cohortId, cohort: cohortName(x.cohortId), sharedThemes: x.tagIds.map(tagName) })),
  };
}

function describeVersion(s: AppState, v: ProgrammeVersion, taste: TasteProfile | null) {
  const evidence = latestEvidence(s, v);
  const stale = v.status === 'DRAFT' && v.inputRevision !== s.revision;
  const sameEvidence = Boolean(taste) && (v.mode === 'QLOO') === (taste!.source === 'QLOO_LIVE');
  return {
    versionId: v.id, programmeId: v.programmeId, version: v.version, parentVersionId: v.parentVersionId ?? null,
    status: v.status, stale, mode: v.mode, evidenceSource: evidenceLabel(evidence), evidenceSynthetic: evidence?.synthetic ?? v.mode === 'DEMO',
    films: v.items.map(i => {
      const fit = cohortFit(s, i.filmId, evidence);
      const best = [...fit].filter(f => f.score != null).sort((a, b) => b.score! - a.score!)[0];
      // A why-line quotes Qloo ranks, so it is only used when it describes the same evidence the solver used.
      const t = themesFor(sameEvidence ? taste : null, s, i.filmId);
      const qlooThemes = themesFor(taste, s, i.filmId);
      return {
        slotId: i.slotId, slot: slotLabel(s, i.slotId), startAt: i.startAt, format: i.format, filmId: i.filmId, title: i.filmTitle,
        feePence: i.feePence, fee: money(i.feePence),
        why: t?.why ?? (best ? `Strongest cohort fit: ${best.cohort} (rank-percentile ${best.score}) on ${evidenceLabel(evidence)} evidence.` : 'Selected on constraints; no cohort evidence available.'),
        themes: qlooThemes?.themes ?? [], themesSource: qlooThemes ? taste!.source : null, cohortFit: fit,
      };
    }),
    totalCostPence: v.totalCost, totalCost: money(v.totalCost), budgetPence: s.constraints.budgetPence, budget: money(s.constraints.budgetPence),
    leastCoveredCohortScore: r2(v.objective),
    coverage: v.coverage.map(c => ({ cohortId: c.cohortId, cohort: c.cohortName, score: r2(c.score) })),
    explanation: v.explanation,
    ...(v.approvedAt ? { approvedAt: v.approvedAt } : {}),
    ...(v.invalidationReason ? { invalidationReason: v.invalidationReason } : {}),
    ...(v.repair ? { repair: v.repair } : {}),
    claim: 'Coverage is rank-based cohort relevance on a fixed catalogue; not expected attendance and not real rights clearance. Human approval is required.',
  };
}

function diffVersions(s: AppState, from: ProgrammeVersion, to: ProgrammeVersion) {
  const slotIds = [...new Set([...from.items.map(i => i.slotId), ...to.items.map(i => i.slotId)])];
  const slots = slotIds.map(slotId => {
    const a = from.items.find(i => i.slotId === slotId), b = to.items.find(i => i.slotId === slotId);
    return { slotId, slot: slotLabel(s, slotId), before: a ? { filmId: a.filmId, title: a.filmTitle } : null, after: b ? { filmId: b.filmId, title: b.filmTitle } : null, changed: a?.filmId !== b?.filmId };
  });
  const coverage = to.coverage.map(c => {
    const before = from.coverage.find(p => p.cohortId === c.cohortId)?.score ?? null;
    return { cohortId: c.cohortId, cohort: c.cohortName, before: r2(before), after: r2(c.score), delta: before == null ? null : r2(c.score - before) };
  });
  const swapped = slots.filter(x => x.changed);
  const costDeltaPence = to.totalCost - from.totalCost;
  return {
    fromVersionId: from.id, toVersionId: to.id, slots, swapped,
    keptFilms: slots.filter(x => !x.changed && x.after).map(x => x.after!.title),
    removedFilms: from.items.filter(i => !to.items.some(j => j.filmId === i.filmId)).map(i => i.filmTitle),
    addedFilms: to.items.filter(i => !from.items.some(j => j.filmId === i.filmId)).map(i => i.filmTitle),
    costDeltaPence, costDelta: `${costDeltaPence < 0 ? '-' : '+'}${money(Math.abs(costDeltaPence))}`,
    totalCostBefore: money(from.totalCost), totalCostAfter: money(to.totalCost),
    objectiveDelta: r2(to.objective - from.objective), coverage,
  };
}
const diffSentence = (d: ReturnType<typeof diffVersions>) => {
  const swaps = d.swapped.map(x => `${x.slot}: ${x.before?.title ?? '(empty)'} -> ${x.after?.title ?? '(empty)'}`).join('; ');
  const moves = d.coverage.filter(c => c.delta != null && Math.abs(c.delta) >= 0.005).map(c => `${c.cohort} ${c.delta! > 0 ? '+' : ''}${c.delta}`).join(', ');
  return `${d.swapped.length ? `Swapped ${d.swapped.length} slot(s): ${swaps}.` : 'No slots changed.'} Cost ${d.costDelta} (${d.totalCostBefore} -> ${d.totalCostAfter}). Coverage moves: ${moves || 'none'}.`;
};

// ---------- tools ----------
const getWorkspace = defineTool({
  name: 'get_workspace',
  title: 'Get workspace',
  description: 'Start here. Returns the independent cinema being programmed (The Lantern), its screening slots, licence budget, the audience cohorts with their cross-domain taste seeds (music, books, games, films), which evidence mode is active, Qloo live status (configured / last verified), and a summary of programme versions already made in this workspace. Read-only; no network call to Qloo.',
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx) {
    const s = await readState(ctx);
    const q = qloo().status(); const verified = liveVerification();
    const confirmed = s.films.filter(f => f.mappingStatus === 'CONFIRMED').length;
    const data = {
      cinema: { name: s.cinema.name, timezone: s.cinema.timezone, currency: s.cinema.currency, territory: s.constraints.territory },
      budgetPence: s.constraints.budgetPence, budget: money(s.constraints.budgetPence),
      slots: s.slots.map(x => ({ id: x.id, label: x.label, startAt: x.startAt, endAt: x.endAt, format: x.format })),
      cohorts: s.cohorts.map(c => ({ id: c.id, name: c.name, description: c.description, seeds: c.seeds.map(x => ({ name: x.name, domain: x.domain, qlooResolved: Boolean(x.entityId) })) })),
      catalogue: { films: s.films.length, qlooConfirmedMappings: confirmed, rights: 'SYNTHETIC' },
      evidence: { activeMode: s.evidenceMode, defaultModeForNextGeneration: defaultEvidenceMode(), modes: ['QLOO', 'DEMO'], note: 'QLOO uses live Qloo cross-domain taste evidence; DEMO is a deterministic synthetic fixture (no network).' },
      qloo: { configured: q.configured, transport: q.transport, liveVerifiedAt: verified?.at ?? null, liveVerifiedVia: verified?.via ?? null, status: s.providerStatus.qlooStatus },
      programmes: s.versions.map(v => ({ versionId: v.id, version: v.version, status: v.status, mode: v.mode, films: v.items.map(i => i.filmTitle) })),
      revision: s.revision,
    };
    const summary = `${s.cinema.name}: ${s.slots.length} slots, ${s.cohorts.length} cohorts (${s.cohorts.map(c => c.name).join(', ')}), ${s.films.length} synthetic-rights films, budget ${money(s.constraints.budgetPence)}. Qloo ${q.configured ? 'configured' : 'NOT configured (use DEMO mode)'}${verified ? `, live-verified ${verified.at}` : ''}. ${s.versions.length} programme version(s) so far.`;
    return { data, summary };
  },
});

const getTasteDna = defineTool({
  name: 'get_taste_dna',
  title: 'Get Taste DNA',
  description: 'Returns the Qloo-derived "Taste DNA": for each audience cohort, its strongest cultural themes (computed live from Qloo from the cohort\'s music/book/game/film seeds), and for each film the Qloo themes it shares with cohorts plus a one-sentence "why". Includes provenance (QLOO_LIVE vs SYNTHETIC_DEMO), status and the exact workflow of calls. Use it to explain recommendations in cultural terms. Optional filters: cohortId, filmId. May call Qloo (cached) when a key is configured. If status is "unavailable" or source is SYNTHETIC_DEMO, say so; never present synthetic data as Qloo.',
  inputSchema: z.object({ cohortId: idSchema.optional().describe('Only this cohort\'s themes, and films that share themes with it'), filmId: idSchema.optional().describe('Only this film') }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(ctx, input) {
    const s = await readState(ctx);
    if (input.cohortId && !s.cohorts.some(c => c.id === input.cohortId)) throw new AgentToolError('NOT_FOUND', `Unknown cohortId "${input.cohortId}". Cohorts: ${s.cohorts.map(c => c.id).join(', ')}`);
    if (input.filmId) getFilmSafe(s, input.filmId);
    const taste = await ctx.taste.load();
    const title = (id: string) => s.films.find(f => f.id === id)?.title ?? id;
    const cohorts = taste.cohorts.filter(c => !input.cohortId || c.cohortId === input.cohortId).map(c => ({
      cohortId: c.cohortId, cohort: s.cohorts.find(x => x.id === c.cohortId)?.name ?? c.cohortId,
      seeds: s.cohorts.find(x => x.id === c.cohortId)?.seeds.map(x => `${x.name} (${x.domain})`) ?? [],
      themes: c.tags.map(t => ({ name: t.name, weight: r2(t.weight) })),
    }));
    const films = taste.films.filter(f => (!input.filmId || f.filmId === input.filmId) && (!input.cohortId || f.sharedTags.some(x => x.cohortId === input.cohortId) || input.filmId === f.filmId)).map(f => {
      const t = themesFor(taste, s, f.filmId)!;
      return { filmId: f.filmId, title: title(f.filmId), themes: t.themes, sharedWithCohorts: t.sharedWithCohorts, why: f.why };
    });
    const data = {
      provenance: { source: taste.source, status: taste.status, generatedAt: taste.generatedAt, message: taste.message ?? null, workflow: taste.workflow, live: taste.source === 'QLOO_LIVE' },
      cohorts, films,
      note: 'Theme weights are relative group tendencies, not attendance predictions.',
    };
    const lead = cohorts.map(c => `${c.cohort}: ${c.themes.slice(0, 3).map(t => t.name).join(', ') || 'no themes'}`).join(' | ');
    return { data, summary: `Taste DNA source ${taste.source} (${taste.status}). ${lead}. ${films.length} film(s) with theme explanations.` };
  },
});
function getFilmSafe(s: AppState, id: string) {
  try { return getFilm(s, id); } catch { throw new AgentToolError('NOT_FOUND', `Unknown filmId "${id}". Use search_films to find valid ids.`); }
}

const searchFilms = defineTool({
  name: 'search_films',
  title: 'Search films',
  description: 'Searches the 30-film catalogue. Each film has a title, year, runtime, genres, themes, formats, and SYNTHETIC rights/fee data (fictional, never real clearance) plus which screening slots it is eligible for and why not. Filter by free text (title/genre/theme), format, or eligibleOnly. Use to look up film ids and to check availability before suggesting alternatives.',
  inputSchema: z.object({
    query: z.string().max(200).optional().describe('Case-insensitive match on title, genre, theme or country'),
    format: z.enum(['DCP', 'BLURAY', 'DIGITAL', '35MM']).optional(),
    eligibleOnly: z.boolean().optional().describe('Only films that can legally fill at least one slot right now'),
    limit: z.number().int().min(1).max(30).optional().describe('Default 12'),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, input) {
    const s = await readState(ctx);
    const q = input.query?.trim().toLowerCase();
    const rows = s.films.map(f => {
      const per = s.slots.map(slot => ({ slot, reasons: filmEligibility(f, slot, s.constraints) }));
      return { f, eligibleSlotIds: per.filter(p => p.reasons.length === 0).map(p => p.slot.id), blocked: [...new Set(per.flatMap(p => p.reasons))] };
    }).filter(({ f, eligibleSlotIds }) =>
      (!q || [f.title, f.country, ...f.genres, ...f.themes].some(x => x.toLowerCase().includes(q))) && (!input.format || f.formats.includes(input.format)) && (!input.eligibleOnly || eligibleSlotIds.length > 0));
    const limit = input.limit ?? 12;
    const films = rows.slice(0, limit).map(({ f, eligibleSlotIds, blocked }) => ({
      id: f.id, title: f.title, year: f.year, runtimeMinutes: f.runtimeMinutes, genres: f.genres, themes: f.themes, country: f.country, formats: f.formats,
      rights: rightsView(f), eligibleSlotIds, ...(eligibleSlotIds.length ? {} : { ineligibleBecause: blocked }), qlooMapped: f.mappingStatus === 'CONFIRMED',
    }));
    return { data: { total: rows.length, returned: films.length, films, label: 'Rights, fees and availability are SYNTHETIC demo data.' }, summary: `${rows.length} matching film(s); showing ${films.length}: ${films.map(f => f.title).join(', ') || 'none'}. Rights are synthetic.` };
  },
});

const generateProgrammeTool = defineTool({
  name: 'generate_programme',
  title: 'Generate programme',
  description: 'Runs the constrained solver to build a four-film, two-night programme (4 slots) that maximises the least-served audience cohort subject to rights, territory, format, runtime and budget. The solver, not the model, picks the films. Returns the draft (status DRAFT, not approved) with a version id, each film\'s slot, fee and why-line, total cost vs budget, and per-cohort coverage. mode "QLOO" uses live Qloo cross-domain evidence (needs server-side key); "DEMO" uses a deterministic synthetic fixture with no network. Omit mode to use the server default. Always tell the user which evidence source was used. Creating a draft is safe and repeatable; it never approves anything.',
  inputSchema: z.object({ mode: z.enum(['QLOO', 'DEMO']).optional().describe('Evidence source. Default: QLOO when the server has a Qloo key, else DEMO') }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(ctx, input) {
    const mode = input.mode ?? defaultEvidenceMode();
    const result = await ctx.store.update(ctx.sessionId, async s => {
      const generated = await generateProgramme(s, mode, { parent: s.versions.at(-1) });
      return { state: s, error: generated.error, versionId: generated.version?.id };
    });
    if (result.error || !result.versionId) throw new AgentToolError('GENERATION_BLOCKED', `${result.error ?? 'Generation failed'}${mode === 'QLOO' ? ' (Try mode "DEMO" for a synthetic-evidence programme.)' : ''}`);
    const v = findVersion(result.state, result.versionId);
    const taste = usableTaste(await loadTaste(ctx));
    const d = describeVersion(result.state, v, taste);
    const evidenceNote = mode === 'DEMO' ? ' Evidence is SYNTHETIC (DEMO mode), not Qloo.' : ' Evidence is live Qloo fixed-universe ranks.';
    return { data: { programme: d, tasteSource: taste?.source ?? null, nextStep: 'Present the draft to the user. Only call approve_programme after the user explicitly confirms.' },
      summary: `Draft v${v.version} (${v.id}): ${d.films.map(f => `${f.slot}: ${f.title}`).join('; ')}. Cost ${d.totalCost} of ${d.budget}. Coverage ${d.coverage.map(c => `${c.cohort} ${c.score}`).join(', ')}.${evidenceNote} Not approved.` };
  },
});

const explainFilm = defineTool({
  name: 'explain_film',
  title: 'Explain film',
  description: 'Explains why one film does or does not fit each audience: its rank among candidates for every cohort (from the evidence snapshot used by the programme, Qloo when mode was QLOO), the Qloo themes it shares with each cohort, Qloo\'s one-sentence why, whether it is currently programmed and in which slot, and its (synthetic) rights eligibility. Handles the seed-film case: a film that is itself a cohort seed is unscored by Qloo for that cohort and reported as such, never as zero. Use after generate_programme to justify each pick.',
  inputSchema: z.object({ filmId: idSchema.describe('Film id from search_films or a programme') }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(ctx, input) {
    const s = await readState(ctx);
    const film = getFilmSafe(s, input.filmId);
    const current = [...s.versions].reverse().find(v => v.status === 'APPROVED') ?? latestVersion(s);
    const evidence = latestEvidence(s, current);
    const taste = usableTaste(await loadTaste(ctx));
    const t = themesFor(taste, s, film.id);
    const fit = cohortFit(s, film.id, evidence);
    const slotItem = current?.items.find(i => i.filmId === film.id);
    const eligibility = s.slots.map(slot => ({ slotId: slot.id, slot: slot.label, eligible: filmEligibility(film, slot, s.constraints).length === 0, reasons: filmEligibility(film, slot, s.constraints) }));
    const data = {
      film: { id: film.id, title: film.title, year: film.year, runtimeMinutes: film.runtimeMinutes, genres: film.genres, themes: film.themes, formats: film.formats },
      evidenceSource: evidenceLabel(evidence), evidenceSynthetic: evidence?.synthetic ?? true,
      programmed: slotItem ? { versionId: current!.id, status: current!.status, slotId: slotItem.slotId, slot: slotLabel(s, slotItem.slotId) } : null,
      cohortFit: fit,
      qlooThemes: t ? { source: taste!.source, themes: t.themes, sharedWithCohorts: t.sharedWithCohorts, why: t.why } : { note: 'Taste DNA unavailable for this film.' },
      rights: rightsView(film), eligibility,
    };
    const fits = fit.map(f => f.status === 'RANKED' ? `${f.cohort} #${f.rank}/${f.of}` : `${f.cohort} ${f.status === 'SEED_FILM_UNSCORED' ? 'seed film (unscored by Qloo)' : 'unknown'}`).join('; ');
    return { data, summary: `${film.title}${slotItem ? ` (programmed: ${slotLabel(s, slotItem.slotId)})` : ''}. ${fits}. Cohort ranks are from ${evidenceLabel(evidence)} evidence. ${t ? `Taste DNA (${taste!.source}): ${t.why}` : 'No taste explanation available.'}` };
  },
});

const approveProgramme = defineTool({
  name: 'approve_programme',
  title: 'Approve programme',
  description: 'Records the HUMAN decision to approve a programme version. This is the only way a programme becomes approved and it cannot be undone except by changes that invalidate it. NEVER call this on your own initiative: first show the user the draft (films, slots, cost, coverage, evidence source) and get their explicit confirmation in the conversation, then call with userConfirmed=true. Fails if the draft is stale, invalidated, superseded, or no longer satisfies rights/budget constraints. Approval does not book films or clear real rights.',
  inputSchema: z.object({ versionId: idSchema.describe('Draft version id from generate_programme or repair_programme'), userConfirmed: z.literal(true).describe('Must be true: set only after the human explicitly asked you to approve this version') }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, input) {
    const state = await ctx.store.update(ctx.sessionId, s => { findVersionSafe(s, input.versionId); return approveVersion(s, input.versionId); });
    const v = findVersion(state, input.versionId);
    const d = describeVersion(state, v, null);
    return { data: { approved: true, programme: d }, summary: `Approved v${v.version} (${v.id}): ${d.films.map(f => f.title).join(', ')}. Cost ${d.totalCost}. Planning approval only; no booking, no real rights cleared.` };
  },
});
function findVersionSafe(s: AppState, id: string) {
  try { return findVersion(s, id); } catch { throw new AgentToolError('NOT_FOUND', `Unknown versionId "${id}" in this workspace. Call get_workspace to list versions.`); }
}

const withdrawRights = defineTool({
  name: 'withdraw_rights',
  title: 'Withdraw rights',
  description: 'Simulates a rights change: marks the (synthetic) screening rights for one film as unavailable. If that film is in a programme, the approved version is INVALIDATED and the solver automatically produces a minimal-change repair draft; the result reports what was invalidated and the repair diff (swapped films, cost delta, coverage moves). The repair draft still needs human approval via approve_programme. Only call when the user has asked for this change or explicitly asked "what if" and you will make that clear. Synthetic data only; no real distributor is contacted.',
  inputSchema: z.object({ filmId: idSchema.describe('Film whose rights fall through'), reason: z.string().max(500).optional() }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async run(ctx, input) {
    const { state, event } = await ctx.store.update(ctx.sessionId, async s => {
      getFilmSafe(s, input.filmId);
      await revokeRights(s, input.filmId, input.reason);
      return { state: s, event: s.events.at(-1)! };
    });
    const film = getFilmSafe(state, input.filmId);
    const invalidated = event.invalidatedVersionIds.map(id => findVersion(state, id));
    const repaired = event.repairedVersionId ? findVersion(state, event.repairedVersionId) : undefined;
    const before = repaired?.parentVersionId ? state.versions.find(v => v.id === repaired.parentVersionId) : undefined;
    const taste = repaired ? usableTaste(await loadTaste(ctx)) : null;
    const diff = repaired && before ? diffVersions(state, before, repaired) : null;
    const data = {
      filmId: film.id, title: film.title, rightsAvailable: film.rights.available, reason: input.reason ?? null,
      invalidatedVersions: invalidated.map(v => ({ versionId: v.id, version: v.version, reason: v.invalidationReason })),
      repairDraft: repaired ? describeVersion(state, repaired, taste) : null, diff,
      ...(event.repairError ? { repairError: event.repairError } : {}),
      nextStep: repaired ? 'Show the user the diff. Call approve_programme with the repair draft version id only after the user explicitly confirms.' : undefined,
    };
    const head = `Rights for "${film.title}" withdrawn (synthetic).`;
    const summary = repaired && diff
      ? `${head} ${invalidated.length ? `Invalidated ${invalidated.length} approved version(s). ` : ''}Repair draft v${repaired.version} (${repaired.id}): ${diffSentence(diff)} Awaiting human approval.`
      : event.repairError ? `${head} No feasible repair: ${event.repairError}` : `${head} No existing programme was affected.`;
    return { data, summary };
  },
});

const repairProgramme = defineTool({
  name: 'repair_programme',
  title: 'Repair programme',
  description: 'Produces (or returns) a minimal-change repair draft for a programme version whose constraints no longer hold, e.g. after withdraw_rights, a budget change or a format loss. Keeps as many original films in their slots as possible, then maximises least-served cohort coverage. Returns the repair draft plus a diff against the original: swapped films, cost delta, coverage moves. policy MINIMAL_CHANGE (default) or GLOBAL_FAIRNESS (re-optimise freely). If versionId is omitted, the most recent invalidated version (else the latest) is repaired. withdraw_rights already creates a repair automatically, in which case this returns it. The draft still needs approve_programme.',
  inputSchema: z.object({ versionId: idSchema.optional(), policy: z.enum(['MINIMAL_CHANGE', 'GLOBAL_FAIRNESS']).optional() }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(ctx, input) {
    const out = await ctx.store.update(ctx.sessionId, async s => {
      const target = input.versionId ? findVersionSafe(s, input.versionId) : [...s.versions].reverse().find(v => v.status === 'INVALIDATED') ?? latestVersion(s);
      if (!target) return { state: s, error: 'No programme exists yet. Call generate_programme first.' as string | undefined, repairId: undefined as string | undefined, parentId: undefined as string | undefined, reused: false };
      const existing = input.policy ? undefined : s.versions.find(v => v.parentVersionId === target.id && v.repair && v.status === 'DRAFT' && v.inputRevision === s.revision);
      if (existing) return { state: s, error: undefined, repairId: existing.id, parentId: target.id, reused: true };
      const generated = await generateProgramme(s, target.mode, { parent: target, trigger: 'REPAIR', repairPolicy: input.policy ?? 'MINIMAL_CHANGE' });
      return { state: s, error: generated.error, repairId: generated.version?.id, parentId: target.id, reused: false };
    });
    if (out.error || !out.repairId || !out.parentId) throw new AgentToolError('REPAIR_BLOCKED', out.error ?? 'Repair failed');
    const repaired = findVersion(out.state, out.repairId), before = findVersion(out.state, out.parentId);
    const taste = usableTaste(await loadTaste(ctx));
    const diff = diffVersions(out.state, before, repaired);
    return { data: { reusedExistingRepair: out.reused, repairDraft: describeVersion(out.state, repaired, taste), diff, nextStep: 'Show the user the diff; approve only on explicit confirmation.' },
      summary: `Repair draft v${repaired.version} (${repaired.id}) from v${before.version}. ${diffSentence(diff)} Awaiting human approval.` };
  },
});

const compareVersions = defineTool({
  name: 'compare_versions',
  title: 'Compare versions',
  description: 'Compares two programme versions in this workspace: per-slot film changes, kept/added/removed films, cost delta and per-cohort coverage deltas. Use to explain the effect of a rights change or to contrast alternatives. Version ids come from get_workspace, generate_programme or repair_programme.',
  inputSchema: z.object({ fromVersionId: idSchema, toVersionId: idSchema }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, input) {
    const s = await readState(ctx);
    const diff = diffVersions(s, findVersionSafe(s, input.fromVersionId), findVersionSafe(s, input.toVersionId));
    return { data: diff, summary: diffSentence(diff) };
  },
});

const exportProgramme = defineTool({
  name: 'export_programme',
  title: 'Export programme',
  description: 'Exports an APPROVED programme: the final schedule (slots, films, formats, fees), total cost, evidence provenance, and a DRAFT rights-enquiry letter text (not sent). Only works for a currently approved, still-valid version; if versionId is omitted the latest approved version is used. Rights and fees remain synthetic; nothing is booked or sent.',
  inputSchema: z.object({ versionId: idSchema.optional() }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, input) {
    const s = await readState(ctx);
    const v = input.versionId ? findVersionSafe(s, input.versionId) : [...s.versions].reverse().find(x => x.status === 'APPROVED');
    if (!v || v.status !== 'APPROVED') throw new AgentToolError('APPROVAL_REQUIRED', 'Only a currently approved programme can be exported. Get explicit user confirmation, then call approve_programme.');
    const violations = currentViolations(s, v);
    if (violations.length) throw new AgentToolError('REVALIDATION_FAILED', 'Programme requires fresh approval', violations);
    const evidence = s.evidence.find(e => e.id === v.evidenceId);
    const d = describeVersion(s, v, null);
    return { data: {
      cinema: s.cinema, programme: d,
      evidence: evidence ? { id: evidence.id, mode: evidence.mode, source: evidence.sourceLabel, synthetic: evidence.synthetic, warnings: evidence.warnings, claim: evidence.claim } : null,
      rightsEnquiryDraft: rightsEnquiryText(s, v),
      notice: 'Programme planning export only. Approval does not book films or clear real rights.',
    }, summary: `Exported approved v${v.version}: ${d.films.map(f => `${f.slot} ${f.title}`).join('; ')}. Total ${d.totalCost}. Includes an unsent rights-enquiry draft.` };
  },
});

/** The registry. Order is the suggested workflow order. */
export const agentTools: readonly AgentTool[] = [getWorkspace, getTasteDna, searchFilms, generateProgrammeTool, explainFilm, approveProgramme, withdrawRights, repairProgramme, compareVersions, exportProgramme];

export const getAgentTool = (name: string): AgentTool | undefined => agentTools.find(t => t.name === name);

/** JSON Schema (draft 2020-12 as emitted by zod 4) for a tool's input; suitable for MCP, OpenAI and Gemini function declarations. */
export function toolInputJsonSchema(tool: AgentTool): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.inputSchema, { io: 'input', target: 'draft-7' }) as Record<string, unknown>;
  return schema;
}
/** Provider-neutral function declarations ({ name, description, parameters }) for LLM function calling. */
export function toolDeclarations(tools: readonly AgentTool[] = agentTools) {
  return tools.map(t => ({ name: t.name, description: t.description, parameters: toolInputJsonSchema(t) }));
}

/**
 * Validate + run a tool by name. Never throws for expected failures: returns { ok:false, error } so an LLM loop can
 * feed the message back to the model. Unexpected errors are reported generically (no stack, no secrets).
 */
export async function invokeAgentTool(ctx: AgentToolContext, name: string, rawInput: unknown): Promise<AgentToolOutcome> {
  const tool = getAgentTool(name);
  if (!tool) return { ok: false, tool: name, error: { code: 'UNKNOWN_TOOL', message: `Unknown tool "${name}". Available: ${agentTools.map(t => t.name).join(', ')}` } };
  const parsed = tool.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false, tool: name, error: { code: 'INVALID_INPUT', message: parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') } };
  try {
    const result = await tool.run(ctx, parsed.data);
    return { ok: true, tool: name, ...result };
  } catch (error) {
    if (error instanceof AgentToolError) return { ok: false, tool: name, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } };
    if (error instanceof ApiError) return { ok: false, tool: name, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } };
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'TOOL_FAILED';
    const message = code.startsWith('QLOO') || code === 'NOT_CONFIGURED' ? `Qloo request failed (${code}). Try mode "DEMO".` : 'The tool failed safely. Check server diagnostics.';
    return { ok: false, tool: name, error: { code, message } };
  }
}
