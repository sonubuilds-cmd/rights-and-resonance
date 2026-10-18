import { createSyntheticTasteProfile, type TasteProfile } from '@rr/domain';

/** Anything that can produce a Taste DNA profile. Keep implementations side-effect free on construction. */
export interface TasteDnaSource { load(): Promise<TasteProfile>; }

/** Default: deterministic profile derived from the local demo fixture. Always labelled SYNTHETIC_DEMO. */
export class SyntheticTasteSource implements TasteDnaSource {
  async load(): Promise<TasteProfile> { return createSyntheticTasteProfile(); }
}

/**
 * TODO(live-qloo): LIVE QLOO PLUG-IN POINT.
 * Implement `load()` with the server-only adapter from `@rr/qloo` (entity_tags / insights per cohort seed and
 * per mapped film `qlooEntityId`), mapping results into TasteProfile with `source: 'QLOO_LIVE'`.
 * Until that is wired, this source reports `unavailable` and NEVER returns fabricated live data.
 */
export class LiveQlooTasteSource implements TasteDnaSource {
  async load(): Promise<TasteProfile> {
    return {
      source: 'QLOO_LIVE', generatedAt: new Date().toISOString(), workflow: [], cohorts: [], films: [],
      status: 'unavailable', message: 'The live Qloo Taste DNA source is not wired yet. No live data is shown.',
    };
  }
}

/** Source selection. Live is opt-in via TASTE_SOURCE=qloo; everything else uses the synthetic source. */
export function createTasteSource(env: NodeJS.ProcessEnv = process.env): TasteDnaSource {
  return env.TASTE_SOURCE === 'qloo' ? new LiveQlooTasteSource() : new SyntheticTasteSource();
}
