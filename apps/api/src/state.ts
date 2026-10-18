import { createDemoData } from '@rr/domain';
import { rankNormalizeAffinities } from '@rr/solver';
import type { AppState, EvidenceMode } from './types.js';
import { loadResolvedMappings } from './taste-live.js';

/** Live Qloo mappings pre-confirmed from the recorded probe fixture; only used when a server-side key is configured. */
function liveMappings() {
  if (!process.env.QLOO_API_KEY?.trim() || process.env.QLOO_PRECONFIRMED_MAPPINGS === 'off') return undefined;
  try { const m = loadResolvedMappings(); return Object.keys(m.films).length >= 25 ? m : undefined; } catch { return undefined; }
}
/** QLOO when a key is configured and the mapping gate (>=25 confirmed films) is satisfied; DEMO otherwise. DEMO stays selectable. */
export function defaultEvidenceMode(): EvidenceMode { return liveMappings() ? 'QLOO' : 'DEMO'; }
export function currentProviderConfiguration() {
  return {
    qlooConfigured: Boolean(process.env.QLOO_API_KEY?.trim()),
    llmConfigured: Boolean(process.env.LLM_API_KEY?.trim() && process.env.LLM_MODEL?.trim()),
  };
}
export function createInitialState(persistence: 'memory' | 'postgres' = 'memory'): AppState {
  const demo = createDemoData();
  const live = liveMappings();
  const confirmedAt = new Date().toISOString();
  const mappings: AppState['mappings'] = {};
  if (live) {
    for (const film of demo.films) { const id = live.films[film.id]; if (id) { film.qlooEntityId = id; film.mappingStatus = 'CONFIRMED'; mappings[film.id] = { entityId: id, confirmedAt, title: film.title }; } }
    for (const cohort of demo.cohorts) for (const seed of cohort.seeds) { const id = live.seeds[`${cohort.id}:${seed.name}`]; if (id) seed.entityId = id; }
  }
  return {
    ...demo, affinities: rankNormalizeAffinities(demo.films,demo.cohorts,demo.affinities).matrix, versions: [], events: [], runs: [], evidence: [], evaluations: [], revision: 0, mappings,
    providerStatus: {
      ...currentProviderConfiguration(),
      persistence, defaultMode: defaultEvidenceMode(), qlooStatus: process.env.QLOO_API_KEY?.trim() ? 'CONFIGURED_NOT_VERIFIED' : 'UNVERIFIED',
      note: `${demo.notice} ${persistence === 'memory' ? 'Memory persistence: this isolated demo session is lost when the API restarts.' : 'PostgreSQL persistence is enabled.'}`,
    },
  };
}
