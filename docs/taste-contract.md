# Taste DNA contract (v0.3 build)

Shared shape between the API (`apps/api`) and the web app (`apps/web`).
Types live in `packages/domain/src/index.ts` (exported as `TasteProfile` etc.).

`GET /api/taste` → `TasteProfile`

```ts
type TasteSource = 'QLOO_LIVE' | 'SYNTHETIC_DEMO';
type TasteTag = { id: string; name: string; weight: number /* 0..1 relative */ };
type TasteProfile = {
  source: TasteSource;               // SYNTHETIC_DEMO must be visibly labelled in the UI
  generatedAt: string;               // ISO UTC
  workflow: string[];                // e.g. ['qloo exec entity_tags', 'qloo api /v2/insights']
  cohorts: Array<{ cohortId: string; tags: TasteTag[] }>;   // cohort "taste DNA" (top ~8)
  films: Array<{
    filmId: string;
    tags: TasteTag[];                // top ~6
    sharedTags: Array<{ cohortId: string; tagIds: string[] }>; // film∩cohort overlap
    why: string;                     // one plain sentence, e.g. "Shares 'melancholy' and 'coming of age' with Film Society"
  }>;
  status: 'ok' | 'partial' | 'unavailable';
  message?: string;                  // human-readable when partial/unavailable
};
```

Rules: never fabricate live data; when no key, return `SYNTHETIC_DEMO` built from
the demo fixture and labelled as such. Rank/affinity values are relative group
tendencies, not attendance predictions.

## Implementation notes (v0.3)

- Types and the deterministic synthetic builder: `packages/domain/src/taste.ts` (`createSyntheticTasteProfile`, `TasteProfileSchema`).
- Provider seam: `apps/api/src/taste.ts` (`TasteDnaSource { load(): Promise<TasteProfile> }`). **Live Qloo is the default when `QLOO_API_KEY` is set**;
  `TASTE_SOURCE=synthetic` forces the labelled demo source, `TASTE_SOURCE=qloo` forces live (honest `unavailable` without a key).
- Live source: `apps/api/src/taste-live.ts` (`LiveQlooTasteSource`, pure `buildLiveTasteProfile`). Mappings come from
  `packages/qloo/fixtures/resolved-mappings.json` (30 films, 9 seeds). Cold load = 7 Qloo requests: `/entities` (film records and their tags),
  `/v2/insights?filter.type=urn:tag&filter.tag.types=urn:tag:theme:qloo&filter.parents.types=urn:entity:movie` per cohort (top 50 theme tags; display top 8,
  weight = min-max relative within that pool), and the movie fixed-universe insights per cohort (rank; shares the adapter cache with programme generation).
  Result is cached in-process for `QLOO_CACHE_TTL_MS` (default 15 min; 30 s for `unavailable`), concurrent loads are de-duplicated.
- Film tags are the film's Qloo `urn:tag:theme:qloo` tags (genre/plot fallback if fewer than 3), cohort-shared tags first, max 6. Film tag `weight` is the strongest
  cohort weight observed for that tag; `0` means no cohort signal, not unimportant. `sharedTags` match by tag id against the cohort's full 50-tag pool, so a shared
  id is always in the film's `tags` but may fall outside the cohort's displayed top 8.
- `why` is a fixed template over real shared tag names and the film's Qloo rank in the lead cohort (the sharing cohort that ranks it best). Never an LLM. Films that are
  seeds have no rank in their own cohort (Qloo omits seeds) and say nothing about it.
- `status: partial` with a `message` when any lookup was incomplete/failed; `unavailable` when nothing could be read. Sample: `docs/taste-live-sample.md`.
- `GET /api/taste` shares the global Origin allowlist, session cookie and `Cache-Control: no-store` hooks.
- Web: `apps/web/src/TasteDna.tsx` ("Taste DNA" surface and the "Why this film" block on each programme row).
