# Delivery validation

This record separates implemented code from executed checks. It does not certify live Qloo coverage, real screening rights, or production readiness.

## v0.2.1 verification — 4 October 2026

- **74/74 Vitest tests PASS**, six files: 16 solver, 21 adapter, 14 official-harness, 7 probe/reporting and 16 API integration tests
- Root and web strict TypeScript checks: **PASS**
- Production Vite build with `NODE_ENV=production`: **PASS**. The old template's `NODE_ENV=development` was found to include development React in a production build; that default is removed from the new template
- **Real loopback HTTP golden path PASS**, using the new `pnpm test:http` script: health, isolated session, generation, draft export blocked, approval, export, rights withdrawal, original invalidation, one-slot repair, invalidated export blocked, reapproval, export, diff and second-session isolation
- Original synthetic slate: Aftersun, Akira, Her, Sound of Metal. Repair replaced Aftersun with Portrait of a Lady on Fire; approved repaired cost GBP 1,650. These are deterministic demo results, not live recommendations
- **Live Qloo probe (2026-10-18): all four gates PASS** (30/30 films, 9/9 seeds, 3 complete distinct profiles, harness 0.1.26). Root causes fixed: live `/search` has no `success` key, and Qloo omits seed entities from insights results. Five duplicate-record cases use the manually reviewed `packages/qloo/fixtures/confirmed-mappings.json`. Details in `QLOO_CONTRACT.md`. Raw reports stay private and uncommitted.
- Keyless probe: **UNVERIFIED**, expected exit 2; all gates and mapped count `null`; installed harness READY; zero live Qloo calls. The included shareable summary was generated only from this no-key run
- Real official harness and new probe flow exercised with synthetic HTTP fixtures. Tests cover full 30-film/three-profile gate, fail-fast 401/403/429/500, summary omission of arbitrary provider content, escaped credential echo, stale film identity and duplicate seed IDs
- Official documentation checked through the cloud browser. Documented endpoints, movie identity/score schema, candidate filter and response envelopes are aligned; authentication and real returned coverage remain **UNVERIFIED**
- **Browser tests NOT RUN successfully**: Playwright failed while starting its configured dev servers, before any assertions. Dot's cloud browser rejected the local preview with `ERR_BLOCKED_BY_CLIENT`; no bypass attempted
- API/web each logged a loopback listening address, but separate shell executions could not connect to those isolated loopbacks. The real HTTP smoke was therefore run with server/client in one execution. There is no verified user-accessible hosted preview
- Node 24.19.0 / preinstalled pnpm 11.19.0. After version-only manifest changes, pnpm's automatic dependency verification attempted an install and failed creating its external store directory. Final tests/typechecks/build were run via the existing installed local binaries, with no dependency changes. The documented fresh-install pin remains pnpm 10.18.3
- No LLM, PostgreSQL, Docker, deployment, publication, live rights or live audience-outcome validation

## Prior v0.2.0 executed checks

Final v0.2.0 aggregate checks passed on 2 October 2026:

- Full-project strict TypeScript check: PASS
- Vitest: **65/65 PASS** (16 solver, 21 adapter contracts, 14 official-harness contracts, 14 API integration tests), 5 test files, approximately 8.2 seconds
- Real installed `@qloo/qloo-harness@0.1.26` exercised using synthetic HTTP fixtures, including search, multiple entity IDs, fixed-universe Insights, raw explanation retention, HTTP status and Retry-After
- Local harness capability subprocess and its execution deadline exercised without provider calls
- Web strict TypeScript check: PASS
- Vite production build: PASS; JavaScript 335.05 kB / 101.18 kB gzip, CSS 29.11 kB / 6.84 kB gzip
- Browser bundle checked for accidental server transport code; no QlooClient implementation, X-Api-Key header construction or node:child_process inclusion found
- Playwright discovery from the initial build: 2 tests found; browser execution still NOT RUN
- Validation environment: Node 24.19.0 and pnpm 11.19.0. Project minimum is Node 22.19.0; the documented package-manager pin remains pnpm 10.18.3

- Deterministic solver exercised against the synthetic 30-film, three-cohort, four-slot fixture.
- API generation, explicit approval, rights withdrawal, invalidation, repair and reapproval exercised through Fastify integration tests.
- Infeasible repair preserves the event and invalidated history instead of restoring an unsafe approval.
- Synthetic Qloo contract fixtures exercised parsing, missing evidence, normalization, request validation and bounded provider failure behavior. These are not recordings of live provider calls.
- No-key Qloo probe executed and returned `UNVERIFIED` with exit code 2, as intended. The local official harness was READY at version 0.1.26, while live verification and all feasibility gates remained unverified. No live provider call was made.
- The seed utility and actual local memory API health/reset smoke were exercised successfully.

## Not verified here

- Browser golden-path and responsive visual checks: the existing cloud browser rejected the local preview URL, the browser executable download was blocked by network policy, and a preinstalled Chromium launch was denied before navigation by the environment’s socket restrictions. Playwright test source is included for execution in an environment with Chromium available. A successful frontend build is not a browser-test pass.
- Live Qloo authentication, 25+ confirmed film mappings, useful differentiation across three cohorts, and returned explainability. Run `pnpm probe` with your own server-side credentials, and follow `live-validation-checklist.md`.
- LLM provider calls. Unconfigured mode is explicit and no model scores are fabricated.
- PostgreSQL/Neon integration or migration execution against a real database. The optional implementation and SQL migration are included; the executed API integration checks use isolated memory persistence.
- Docker build, hosted deployments, public repository publication, or competition submission. No such external actions were performed.

## Scope notes

- All demo rights, fees and taste affinities are synthetic. Actual film metadata and licensing terms must be checked before real use.
- Generation maximizes the lexicographic fairness objective. Minimal-change repair prioritizes fewer changed slot assignments, then the fairness/diversity/cost tuple.
- Diversity is a transparent distinct-genres-plus-countries proxy. Franchise and release-year concentration penalties are not implemented.
- Narrative and rights-enquiry text use deterministic evidence-backed templates. The optional LLM adapter is used for the LLM-only ranking baseline; natural-language briefs are deferred.
- Anonymous sessions provide demo isolation, not organizational identity or production authorization.

- Affinity/profile Qloo requests preserve completed, partial and failed run evidence. Entity-search and mapping confirmations return provider evidence, but not every failed mapping lookup has a durable audit record.
