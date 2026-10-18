# Qloo integration and live feasibility gate

## Verification status

**No live Qloo calls were made during this build.** `reports/qloo-probe.json` records `UNVERIFIED` when `QLOO_API_KEY` is absent; its gates and mapped count are `null`, not fabricated measurements. Contract tests use hand-authored **synthetic contract fixtures**, never recorded API evidence. These tests prove local request/parsing behavior, not account access, coverage, or quality.

v0.2.1 also writes `reports/qloo-probe-summary.json`, a shareable allowlisted projection. It includes only fixed status/code labels, counts and numeric diagnostics. Full raw responses, names/IDs, request URLs, headers, upstream messages and explanations are omitted. Keep the full report local; use the summary for support. A custom `QLOO_PROBE_OUTPUT` places the summary beside that file with a `-summary.json` suffix. Fatal authentication, access, rate-limit, availability and harness failures stop the probe immediately; unfinished gates remain unverified. Both wire-text and decoded-JSON credential echoes are rejected before evidence is retained.

Official documentation was rechecked on 4 October 2026 in the cloud browser: the hackathon origin, header, GET endpoints, `success`/`results.entities` envelopes, movie subtype/release-year/affinity schema, movie candidate filter, 50-result limit and explainability layout match this adapter. This is a documentation check, not an authenticated provider observation. Nested compatibility variants remain supported but are not relied on as the canonical movie schema.

Original endpoint references were inspected in the cloud browser on 2026-10-01. The developer guide, Search enum and movie parameter table were rechecked on 2026-10-02; the official kit and harness 0.1.26 were also inspected. See [hackathon alignment](hackathon-alignment.md) for the pinned kit commit, setup and source discrepancies. These are documentation checks, not authenticated API observations:

- [Hackathon developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide): hackathon origin, GET method, `X-Api-Key`, separate lookup endpoints, unsupported parameters can be silently ignored
- [Insights API](https://docs.qloo.com/reference/insights-api-deep-dive): query names, `take` maximum 50, `results.entities` envelope, optional per-result and aggregate `query.explainability`
- [Search entities](https://docs.qloo.com/reference/get-search): `/search`, `query`, `types`, `take`, results-array envelope
- [Entity ID lookup](https://docs.qloo.com/reference/get-entities): `/entities` with `entity_ids`
- [Movie schema](https://docs.qloo.com/reference/schema-taxonomy): UUID `entity_id`, `name`, `subtype`, `release_year`, bounded numeric `affinity`
- [Entity-type parameter guide](https://docs.qloo.com/reference/available-parameters-by-entity-type): Movie supports the candidate filter, interest signal and take parameter

The Search and Insights enumerations use `urn:entity:videogame`. The hackathon guide's prose also contains `urn:entity:video_game`; the adapter/probe use the explicit endpoint enumeration. `feature.explainability` is documented in the main Insights reference but omitted from the movie-specific table. It is optional; absence or a provider warning never becomes an invented explanation. Actual account/environment support still needs the live probe.

## Server boundary

`@rr/qloo` imports Node crypto and rejects browser execution. Never import it into the web application. Only the API process/probe reads `QLOO_API_KEY`. The key is sent solely as `X-Api-Key`, never a URL parameter or Bearer token. Only the HTTPS origin `hackathon.api.qloo.com` is accepted. Production, staging, arbitrary gateways, custom ports, paths and credentials embedded in URLs are rejected before transmitting the key. Redirects fail closed. Do not place keys in any `VITE_*` variable, fixture, report, URL, or checked-in file.

`QlooClient({apiKey, baseUrl, transport, timeoutMs, maxAttempts, retryBudgetMs, cacheTtlMs})` defaults to the official harness transport, hackathon origin, 10-second per-attempt timeout, at most three attempts, a 5-second total retry-wait budget and 15-minute in-memory cache. It does not load environment variables itself. The API and probe supply their explicit environment settings. A missing key never adopts a saved global harness credential.

The `harness` transport runs the pinned `@qloo/qloo-harness@0.1.26` package through its public `runQloo` entry point and `qloo api` route in a temporary, bounded child process. It has no shell, arbitrary executable or secret in argv. The child fixes both upstream `QLOO_BASE_URL` and `QLOO_TRUSTED_BASE_URL` to the hackathon origin, uses an isolated config directory, checks the exact GET request before transmission and rejects redirects. The adapter observes the original response because the published CLI's JSON formatter otherwise drops its envelope. `direct-http` is an explicit compatibility transport; failures never switch transports automatically.

`readiness()` checks the actual installed harness version and `api search`, `api entity`, and `api insights` help capabilities with network access blocked at its request boundary. `READY` is local software readiness; `configured` means an explicit key exists; `liveVerification` remains `UNVERIFIED`. None proves provider authentication.

Errors contain fixed safe messages; upstream error bodies and thrown network strings are discarded. 401/403/404 and other nontransient failures are not retried. For network/timeouts, 429 and 5xx, bounded retries respect both numeric and HTTP-date `Retry-After`. If a provider delay exceeds the remaining wait budget, the call stops with `retryAfterMs`, `retryAt` (when representable), and `retryBudgetExceeded` failure metadata; it never clips that delay to retry early. Absent provider delay, exponential waits start at 250 ms. Response bodies are limited to 4 MB.

## Request contract

- `search(query, {type?, take?})` sends `GET /search` with `query`, optional `types`, and `take`
- `entities(ids)` sends `GET /entities?entity_ids=…` and checks exact requested-set coverage
- `insights({seedEntityIds, candidateEntityIds, explainability?, take?})` sends `GET /v2/insights`

Insights has an explicit allowlist only:

```
filter.type=urn:entity:movie
signal.interests.entities=<verified comma-separated UUIDs>
filter.results.entities=<same fixed comma-separated candidate UUIDs>
feature.explainability=true|false
take=<candidate count, at most 50>
```

The harness command mapping is `api search --query ... --take ... --params <validated JSON> --json`, `api entity --id <verified UUIDs> --json`, and `api insights --type urn:entity:movie --take ... --params <validated JSON> --json`. These arguments are constructed by the adapter, not accepted from the browser. Search type URNs pass through the `types` parameter rather than the upstream CLI's convenience aliases.

There is no arbitrary query passthrough, unsupported parameter fallback, or legacy recommendations endpoint. Unknown request options, non-UUID identifiers, duplicates, empty sets, more than 50 candidates, and a `take` smaller than the universe are rejected before transmission.

## Parsing, normalization and evidence

The parser validates known response envelopes and fields without discarding the full parsed JSON in `raw`. `QlooEntity` exposes `entityId`, `name`, `type`, `releaseYear`, `rawAffinity`, optional `explainability`, and the original entity in `raw`. It supports flattened fields and the explicit nested `properties.release_year` / `query.affinity` representation. Missing, null, string, nonfinite, or out-of-range affinity values stay `null`. Malformed/duplicate rows are reported as incomplete; an unrecognized envelope or absent success assertion is `unknown`.

Every cohort must use the **same frozen mapped film universe**, including films later made rights-ineligible, so event repairs do not change score scales. The feasibility probe may operate on 25–30 mapped films; it explicitly lists this universe and excludes unmapped/ambiguous films. New mapping decisions require a new universe and evidence set. Within that universe, every candidate needs one numeric score. Extra candidates, missing scores, malformed rows, incorrect types, or a partial response withhold **all percentiles** and block a fresh Qloo solve.

Rank percentile is ascending midrank divided by `N-1`: lowest 0, highest 1, equal scores receive equal average ranks. A single-item universe gets 0.5. This is within-cohort rank normalization, not probability, cross-cohort cardinal comparability, or an attendance forecast. Raw Qloo scores remain available alongside percentiles.

`evidence` stores `source: QLOO`, official origin, endpoint, request SHA-256, response SHA-256, `fetchedAt`, `servedAt`, attempts, HTTP status, transport and cache provenance. Harness observations also include package/version, `qloo api` route, command and CLI exit code. Request hashes cover method plus canonical sorted-parameter URL, excluding credentials. Response hashes cover `JSON.stringify(raw)`; candidate-universe hashes cover the sorted lowercase UUID array. All hashes can be recomputed using `hashEvidence` and the retained data where applicable. These establish content identity, not provider signatures.

The instance cache is bounded to 100 entries and caller-visible results/evidence are immutable snapshots. A cached observation retains its original `fetchedAt` and response hash. Fresh hits are `FRESH_CACHE`; a retry-exhausted transient failure may expose at most 24-hour-old evidence as `STALE_CACHE`, with a historical-data warning. Callers must reject stale evidence for a new Qloo-backed programme. No demo score is inserted into the Qloo cache. The adapter's cache is process-local; API persistence is handled separately.

Explainability is returned only if the raw response contains it. Raw `query.explainability` warnings/objects remain visible and unmodified. A missing explanation does not invalidate an otherwise complete affinity set, but must not be described as a provider-supplied reason.

## Live probe

Run `pnpm probe` after exporting the server environment. A sandbox-friendly equivalent is `node --import tsx scripts/qloo-probe.ts`. The script reads:

- `QLOO_API_KEY`, required for real calls
- `QLOO_BASE_URL`, optional, restricted to `https://hackathon.api.qloo.com`
- `QLOO_TRANSPORT`, optional, default `harness`; `direct-http` explicitly selects compatibility mode
- `QLOO_RETRY_BUDGET_MS`, optional, default `5000`, permitted range `0`–`30000`
- `QLOO_TIMEOUT_MS`, optional, default `10000`
- `QLOO_CACHE_TTL_MS`, optional, default `900000`
- `QLOO_PROBE_OUTPUT`, optional, default `reports/qloo-probe.json`

The domain factory supplies exactly 30 films and three fictional taste cohorts. The probe queries films and seeds sequentially, retains raw real responses when calls occur, and reports each mapping. A film automatically maps only on a unique normalized exact title and release-year match. An unknown year, multiple possible matches, stale/partial lookup, or only a fuzzy match needs confirmation. The script never selects the first ambiguous result. Duplicate film-to-entity assignments are rejected.

An optional operator-reviewed overrides JSON can be supplied with `pnpm probe --overrides path/to/confirmed-mappings.json` (or the equivalent Node invocation). Shape:

```json
{"films":{"catalogue-film-id":"verified-qloo-uuid"},"seeds":{"cohort-id:Exact Seed Name":"verified-qloo-uuid"}}
```

Only use this after a person has reviewed the specific candidate identity. Every override is checked through `/entities` for the requested UUID and expected type and marked `manuallyConfirmed`; it is not blindly trusted as a provider response. Unknown override keys fail closed. Do not add made-up IDs to overcome a failed gate.

Gate success requires all of:

1. At least 25 distinct film mappings from the 30-film catalogue
2. Every seed in all three cohorts resolved
3. Complete, non-stale responses for every film in the identical fixed universe for all three cohorts
4. Each profile has at least five distinct raw affinity values; each of the three profile pairs has a different top-five set and mean absolute rank-percentile difference of at least 0.05

The fourth criterion is a transparent project heuristic for useful differentiation, not a statistical or commercial validation. Raw evidence, ambiguous/missing maps, comparisons, and warnings are in the report. Separate per-cohort `explainabilityChecks` list returned per-entity explanation count, aggregate presence, provider warning, and AVAILABLE / UNAVAILABLE / UNVERIFIED status. A feasibility PASS does not imply explainability was available; confirm this separate check before an explainability-dependent demonstration. No-key execution writes `UNVERIFIED` with no network calls and no synthetic fallback. Exit codes: 0 passed, 2 failed/unverified gate, 1 setup/runtime failure. Mapping fewer than all 30 films is disclosed even if the >=25 gate passes. Partial affinity responses must never be filled with zeros.

## Contract checks

`pnpm exec vitest run tests/qloo.test.ts` exercises the request allowlist, header, origin guard, parsing variants, absent explainability, partial/unknown/extra entities, midranks, ambiguity, retries, timeouts, safe errors, cache provenance/expiry and no-key probe. Fixtures live in `packages/qloo/fixtures/synthetic-contract.json`, visibly labelled synthetic. Live gate success must come from the probe with a legitimately configured key, not these tests.
