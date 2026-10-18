import { createDemoData } from '@rr/domain';
import { rankNormalizeAffinities } from '@rr/solver';
import type { AppState } from './types.js';
export function currentProviderConfiguration() {
  return {
    qlooConfigured: Boolean(process.env.QLOO_API_KEY?.trim()),
    llmConfigured: Boolean(process.env.LLM_API_KEY?.trim() && process.env.LLM_MODEL?.trim()),
  };
}
export function createInitialState(persistence: 'memory' | 'postgres' = 'memory'): AppState {
  const demo = createDemoData();
  return {
    ...demo, affinities: rankNormalizeAffinities(demo.films,demo.cohorts,demo.affinities).matrix, versions: [], events: [], runs: [], evidence: [], evaluations: [], revision: 0, mappings: {},
    providerStatus: {
      ...currentProviderConfiguration(),
      persistence, qlooStatus: process.env.QLOO_API_KEY?.trim() ? 'CONFIGURED_NOT_VERIFIED' : 'UNVERIFIED',
      note: `${demo.notice} ${persistence === 'memory' ? 'Memory persistence: this isolated demo session is lost when the API restarts.' : 'PostgreSQL persistence is enabled.'}`,
    },
  };
}
