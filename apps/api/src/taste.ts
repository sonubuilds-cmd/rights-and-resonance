import { createSyntheticTasteProfile, type TasteProfile } from '@rr/domain';
import { LiveQlooTasteSource } from './taste-live.js';
import { qloo } from './evidence.js';

/** Anything that can produce a Taste DNA profile. Keep implementations side-effect free on construction. */
export interface TasteDnaSource { load(): Promise<TasteProfile>; }

/** Default: deterministic profile derived from the local demo fixture. Always labelled SYNTHETIC_DEMO. */
export class SyntheticTasteSource implements TasteDnaSource {
  async load(): Promise<TasteProfile> { return createSyntheticTasteProfile(); }
}

export { LiveQlooTasteSource } from './taste-live.js';

/**
 * Live Qloo is the default whenever a server-side QLOO_API_KEY is configured; TASTE_SOURCE=synthetic forces the demo source,
 * TASTE_SOURCE=qloo forces live (which reports `unavailable` honestly without a key).
 */
export function createTasteSource(env: NodeJS.ProcessEnv = process.env): TasteDnaSource {
  const live = env.TASTE_SOURCE === 'qloo' || (env.TASTE_SOURCE !== 'synthetic' && Boolean(env.QLOO_API_KEY?.trim()));
  return live ? new LiveQlooTasteSource({ client: qloo, cacheTtlMs: Number(env.QLOO_CACHE_TTL_MS ?? 900000) }) : new SyntheticTasteSource();
}
