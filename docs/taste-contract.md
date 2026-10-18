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
- Provider seam: `apps/api/src/taste.ts` (`TasteDnaSource { load(): Promise<TasteProfile> }`). Default is `SyntheticTasteSource`.
  `TASTE_SOURCE=qloo` selects `LiveQlooTasteSource`, a stub returning `status: 'unavailable'`. **Live plug-in point:** implement
  `LiveQlooTasteSource.load()` there using `@rr/qloo`; it must return `source: 'QLOO_LIVE'` and never synthesise values.
- `GET /api/taste` shares the global Origin allowlist, session cookie and `Cache-Control: no-store` hooks.
- Web: `apps/web/src/TasteDna.tsx` ("Taste DNA" surface and the "Why this film" block on each programme row).
