# Rights & Resonance

A cinema-programming workstation that assembles a feasible four-screening slate, shows its evidence, asks a person to approve it, and repairs it when the inputs change.

**This repository is a standalone local synthetic demo.** All included rights availability, licence fees and cohort affinities are invented. They are not Qloo responses, rights clearance, bookings or evidence of audience demand. The live Qloo feasibility gate is **unverified without an API key**. An implemented adapter is not proof of live account access or provider coverage.

See the [v0.2.1 change summary](docs/changes-v0.2.1.md), [Windows quick start](docs/windows-quick-start.md), and [validation record](docs/validation.md) for the checks actually performed. The [v0.2.0 changes](docs/changes-v0.2.0.md) document the official harness integration.

## Start locally

Requires Node.js **22.19.0 or newer** and pnpm 10.18.3. No API key, database, account or external AI service is needed for the default demo. The live path uses the pinned official `@qloo/qloo-harness@0.1.26` package on the server.

```sh
corepack enable
corepack prepare pnpm@10.18.3 --activate
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Open **http://localhost:5173**. The Vite development server proxies `/api` to the API at port 3001. Keep the hostname consistent throughout a session; `localhost` and `127.0.0.1` have different cookies and origins. The API health endpoint is http://localhost:3001/healthz.

The initial workspace contains the fictional Lantern Cinema in Bristol, 30 films, three fictional cross-domain taste cohorts, and four screening slots on 16–17 October 2026. Budget: **GBP 1,850**. The dates are fixed demo inputs, not a rolling schedule. Money is stored as integer pence and timestamps as ISO UTC; the cinema's presentation timezone is Europe/London.

Each browser gets an isolated anonymous demo session. With no `DATABASE_URL`, state is process-local and is lost when the API restarts. Use the interface's reset action for the current browser's session. Clearing cookies creates a different session.

## What to try

1. Generate a programme in **DEMO** mode. Inspect the selected films, licence cost, cohort coverage and evidence source.
2. Approve the proposed version. Approval is an explicit human action; generation alone does not approve it.
3. Revoke the rights of a selected film. The approved version becomes invalid for the changed inputs. Repair creates a new draft with its own evidence and relationship to the original version.
4. Compare the versions and review the replacement before approving it. The original selection and evidence remain available as history.
5. Export the approved programme packet (JSON), or the unsent rights-enquiry draft (text). Inspect the evidence labels and approval status before using either outside the demo.

The [demo script](docs/demo-script.md) walks through the presentation. See [architecture](docs/architecture.md) for the model and workflow and [deployment](docs/deployment.md) for hosting setup.

## Evidence modes

- **DEMO:** complete, explicitly synthetic affinity matrix and rights ledger. Useful for exercising the actual optimiser and workflow without network calls.
- **QLOO:** server-side Qloo integration, with resolved film/seed entities and complete, comparable evidence required before solving. Configuration alone does not make the gate pass. See [Qloo contract](docs/QLOO_CONTRACT.md).
- **METADATA:** an explicitly labelled local comparison derived from curated metadata. It is not Qloo evidence and is not a validated audience model.
- **LLM_ONLY:** an optional model-generated comparison, only when configured. Model output remains subject to validation and the same hard feasibility constraints. Missing credentials must be shown as unavailable, not substituted with fabricated live output.

Affinity is a relative evidence score, **not** a probability that someone will attend. These modes do not establish Qloo superiority, forecasting accuracy, ticket sales or revenue uplift. Comparison results are exploratory, not a benchmark study.

## Commands

Run these from the repository root:

```sh
pnpm dev          # API + Vite, local development
pnpm test         # unit/integration tests
pnpm test:http    # real loopback HTTP synthetic workflow, starts/stops its own API
pnpm typecheck    # strict TypeScript checks
pnpm build        # web production bundle in apps/web/dist
pnpm start        # API only; web hosting is separate
pnpm seed         # initialise/reset an isolated CLI demo session; API must be running
pnpm probe        # Qloo feasibility probe; no-key result is UNVERIFIED
pnpm test:e2e     # browser suite; requires the Playwright browser runtime
```

`pnpm seed` does not alter the browser's session. It is an API smoke/fixture initialization utility. The source fixture is `createDemoData()` in `packages/domain/src/index.ts`.

Unit tests are not a substitute for a browser run or live provider validation. The [delivery validation record](docs/validation.md) identifies the checks actually run and the remaining unverified paths.

## Workspace layout

```text
apps/web/          React + Vite workstation, TanStack Query, Zustand
apps/api/          Fastify API, workflow orchestration, session persistence
packages/domain/   validated types and synthetic demo factory
packages/solver/   deterministic constrained selection and repair
packages/qloo/     server-only provider adapter and normalization
packages/shared/   shared utilities
scripts/           fixture initialization and Qloo feasibility probe
data/              fixture provenance notes
docs/              architecture, demo, deployment, Qloo contract
```

## Qloo hackathon setup and live gate

The [hackathon alignment guide](docs/hackathon-alignment.md) maps this implementation to the official kit and developer guide, including the selected `qloo api` surface, key setup, endpoint, quota boundaries and remaining live checks. The default `QLOO_TRANSPORT=harness` executes the official harness; `direct-http` is an explicit compatibility option, never an automatic fallback.

Request your personal key using the form in the [official developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide#getting-your-api-key). Supply it only as the API process's private `QLOO_API_KEY` environment variable. Keep credentials outside the project folder, prompts, recordings and browser. Never prefix a provider secret with `VITE_`; those variables are embedded in the browser bundle. Restart the API after changing its environment.

**Use `QLOO_BASE_URL=https://hackathon.api.qloo.com`.** The app enforces that origin for this event. The upstream harness defaults to the production origin when used independently, so explicitly set the hackathon origin for standalone commands too. Hackathon keys do not work with production or staging.

After dependency installation, inspect the local harness without making a provider call:

```sh
pnpm --filter @rr/qloo exec qloo --version
pnpm --filter @rr/qloo exec qloo api --help
```

The application deliberately requires its explicit environment key; a credential saved by a separate `qloo setup --qloo` session does not silently enable the app.

Run `pnpm probe` before describing the project as live-Qloo-backed. The report checks account/provider access, film mapping coverage, cohort-seed resolution and complete comparable cohort results. Review ambiguous mappings manually. An unmapped entity, incomplete response, stale cache, rate limit or outage is not evidence of zero affinity.

Share only `reports/qloo-probe-summary.json` when asking for help. The separate `reports/qloo-probe.json` retains raw provider evidence for local inspection and should stay private. The summary uses a fixed allowlist and excludes credentials, headers, raw JSON and arbitrary provider text. The probe stops early on authentication, access, quota, availability or harness failures rather than repeating a broken request across the catalogue. Unfinished gates stay `null` (unverified).

The delivery includes no secret, real rights agreement or guaranteed provider access. The probe report and [Qloo contract](docs/QLOO_CONTRACT.md) are the authority on what was observed. Even a successful gate would validate this technical path only; it would not validate audience outcomes or licence availability.

## Persistence and deployment

The API optionally uses PostgreSQL via `DATABASE_URL`; its migration is under `apps/api/db/migrations/`. Local demo mode needs no database. See [deployment](docs/deployment.md) for the migration process, Neon option, Docker API image, Render blueprint and Cloudflare Pages/Railway setup.

The supplied hosting files are setup materials. Their presence does not mean the app was deployed, accounts were created or a public repository was published. A real deployment requires explicit environment configuration and browser verification, especially for cross-origin session cookies.

## Deliberate boundaries

- The fixture's film metadata is curated and illustrative. Verify runtime, format, territory, screening dates and actual licensing terms with the rights holder before a real event.
- No rights-holder messaging, licence purchase, ticketing integration, payment, booking or attendance forecasting is implemented.
- Anonymous session isolation is suitable for a prototype. There are no named accounts, cinema-team roles, approval identity assurance or production-grade audit-retention guarantees.
- Selection and evidence snapshots are retained in application history, but this is not a signed, tamper-proof legal record. A demo reset clears the active workspace's visible history; it is not a guaranteed permanent database erasure.
- The solver is deliberately bounded to the small catalogue and four-slot scenario. It is not a general multi-cinema scheduling platform.
- Provider terms, live eligibility, database deployment and real-user operations still require their own verification. Do not upload real customer or sensitive audience information to this prototype.

## Licence

[MIT](LICENSE), copyright 2026 Rights & Resonance contributors. Third-party packages retain their respective licences. Film titles and third-party marks identify their respective works and owners; the software licence does not grant screening rights or rights to provider data.
