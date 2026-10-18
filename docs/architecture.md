# Architecture and evidence boundaries

## Purpose

Rights & Resonance is a small, explainable programming workflow for one cinema, 30 catalogue films, three fictional taste cohorts and four screening slots. It joins deterministic feasibility, relative cohort coverage, human approval and event-driven repair. A runnable synthetic demo is the default; a live-Qloo demonstration is a separate, unpassed gate until real account evidence is recorded.

The fictional rights ledger is an operational input to the optimiser, not a claim about a distributor. Affinity is an ordering signal, not attendance, purchase intent, demographic identity or ticket-sales probability.

## Components and data flow

```text
Browser workstation (React / Vite)
  | credentialed JSON requests; no provider secret
  v
Fastify API: session boundary, input validation, change events, approval, export
  |                         |
  | State store             | bounded LangGraph workflow
  | memory or PostgreSQL    | load -> validate -> evidence -> solve -> verify -> draft
  |                         |
  |                         +-- DEMO synthetic fixture
  |                         +-- METADATA lexical baseline
  |                         +-- Qloo server adapter -> official harness qloo api, live evidence gate
  |                         +-- optional LLM-only speculative scores
  |                         |
  |                         v
  +------------------ deterministic solver
                            |
                            v
                 immutable selection/evidence snapshot
                            |
                    explicit human approval
```

`packages/domain` owns Zod schemas, integer-pence money, ISO timestamps and fresh-copy demo fixtures. `packages/solver` owns normalisation, feasibility checks, optimisation and repair comparison. `packages/qloo` owns request mechanics and provider evidence. Its default transport runs the official pinned harness in a bounded server-side child; an explicit direct-HTTP compatibility mode never becomes an automatic fallback. Both are restricted to the hackathon origin. See [hackathon alignment](hackathon-alignment.md). `apps/api` owns session-level state, orchestration, lifecycle decisions and exports. `apps/web` renders the API state; TanStack Query handles server requests and Zustand handles local workstation UI choices.

### Agent access (MCP)

`apps/api/src/agent-tools.ts` is a transport-agnostic tool registry (zod input schemas, LLM-oriented descriptions) that calls the same workflow and state-transition functions as the REST routes (`operations.ts`, `workflow.ts`) against a given session's workspace. The MCP server (`mcp-server.ts`) exposes it over Streamable HTTP at `/mcp` (one isolated in-memory workspace per MCP session, bounded and expiring) and over stdio (`pnpm --silent mcp`). An in-app agent can call the same registry. See [mcp.md](mcp.md).

## The optimiser

The production path in this prototype is an actual exhaustive deterministic solver, not a fixed returned slate or model-picked answer. The implementation is intentionally bounded to at most 30 films, four slots and three cohorts. The supplied fixture uses three cohorts. It validates input structure before searching and returns a complete feasible slate or an explicit failure; it does not quietly return fewer screenings.

### Hard constraints

Every selected film must satisfy all of the following:

- Rights availability is explicitly `true`; `false` and unknown (`null`) are ineligible
- Licence territory equals the cinema constraint
- The licence date window covers the actual screening
- Runtime fits the slot and the required format is available
- Selected films are distinct
- Slots are nonoverlapping
- Total licence cost stays within the integer-pence budget
- Any requested slot/film locks are honored

Changing the narrative explanation cannot override a constraint. Solver output is checked again before saving a draft and current inputs are checked when approving.

### Comparable evidence

For each cohort, scores are ranked on one fixed candidate universe **before** rights eligibility is applied. The percentile is the zero-based average tied rank divided by `n - 1`; equal raw scores receive equal ranks. The solver's singleton case is 0.5. No missing/null/non-finite score is converted to zero; incomplete evidence blocks solving.

The default synthetic and comparison modes use the full 30-film catalogue. Live Qloo mode uses the same explicitly identified confirmed-mapped universe for all three cohorts, with at least 25 confirmed films; exclusions are listed. Comparisons with a different universe must be disclosed and should not be interpreted as equivalent objective measurements. A rights withdrawal does not itself redefine the ranking universe, preventing a spurious coverage improvement caused only by dropping an unavailable film from the denominator.

### Objective

For each cohort, coverage is the mean of its **best two** normalised affinities among the selected films. Candidate programmes are ordered lexicographically:

1. Maximise the minimum cohort coverage
2. Maximise mean cohort coverage
3. Maximise the count of distinct genres plus distinct countries
4. Maximise budget savings
5. Break any remaining tie by the lexicographically smallest chronological `slotId:filmId` sequence

This prioritises the least-served cohort, while keeping the score definition inspectable. It is a design choice, not a validated social-welfare metric or evidence of actual audience representation. Diversity here is a simple metadata count, not a demographic fairness claim. Release-year spread and franchise concentration are not optimized in this implementation.

### Repair

The solver exposes `MINIMAL_CHANGE` and `GLOBAL_FAIRNESS` policies. Minimal-change repair first minimises changed slot assignments, then uses the normal fairness ordering. Global-fairness repair uses the same objective as initial generation. The API's automatic repair defaults to minimal change. Slot/film locks are supported by the solver API; do not assume every low-level option has a UI control.

If an event makes a slate impossible, the API retains the event and invalidation and records the repair failure. There is no valid replacement to approve until the inputs permit one. The solver provides reasons and per-slot exclusions to support diagnosis.

## Workflow and human boundary

The LangGraph workflow is a fixed acyclic sequence:

1. `load_catalogue`: capture session context and revision
2. `validate_inputs`: parse domain schemas and reject malformed inputs
3. `collect_evidence`: gather an explicitly labelled source and snapshot its inputs
4. `solve_constraints`: execute deterministic constrained selection
5. `verify_solution`: independently apply programme validation
6. `save_draft`: append a version linked to its evidence and inputs

It is bounded orchestration, not an open-ended autonomous agent. Provider retries and request timeouts are finite. The optional LLM supplies a validated cohort-film score matrix only; it cannot buy rights, alter the budget, grant approval or bypass feasibility.

Approval is outside the graph. A version starts `DRAFT`; a person approves that exact version against the current state. Later input changes can mark it `INVALIDATED`. Approving a replacement marks any still-approved prior version `SUPERSEDED`. Repair creates a new draft and does not inherit approval. Old selections, rights snapshots, evidence and parent links remain accessible. Lifecycle fields may change, so “immutable version” means immutable selection/evidence content, not that its status can never transition.

## Events and history

Mutations operate on session-scoped state and advance an input revision. Rights, fee, budget, cohort or scheduling changes can make old approvals stale. The change event records which versions were invalidated and whether a repair was produced or failed. A programme version records its ID, parent relationship, selected items, cost, coverage, objective, mode, evidence ID and input revision.

Evidence snapshots copy the inputs and scores used for a solve. Qloo response provenance is separate from synthetic fixtures; the latter are never recorded or described as Qloo responses. Workflow runs capture node names, times, outcomes and failure reasons. The UI and export should keep mode and approval state visible when presenting old versions.

This is an application audit trail, not a signed or cryptographically tamper-proof legal ledger. Server/database administrators could alter storage. A demo reset clears the active workspace and its visible history; retained PostgreSQL projection rows are not a guaranteed legal archive or a personal-data deletion mechanism.

## Qloo integration boundary

See [QLOO_CONTRACT.md](QLOO_CONTRACT.md) for exact endpoint/request/response handling and probe behavior.

- Provider keys stay on the server
- Film and cross-domain seed IDs must be resolved; ambiguous matches require human confirmation
- The technical live solve gate requires at least 25 unique confirmed film mappings, all seed IDs, and complete fresh cohort responses on the same universe
- Missing entities or partial results stay unknown and block a live solve
- A bounded retry may use a historical cache entry for inspection, labelled `STALE_CACHE`; stale evidence cannot silently become a new approved live result
- Provider-supplied explainability is evidence only when actually returned; application narration or LLM text must not be presented as provider explanation

The broader live demonstration gate also needs useful, distinct cohort rankings and observed explainability where available. A client instantiated with a key or one successful HTTP response does not establish that gate. The [live validation checklist](live-validation-checklist.md) makes the gap explicit.

## Baselines and limitations of evaluation

DEMO uses deterministic fabricated scores. Editing its cohort seeds can produce a deterministic hash-based synthetic matrix; this is for exercising workflow changes, not learned cultural taste. METADATA uses lexical overlap between cohort text and film metadata; heavy ties are expected. LLM_ONLY requests a complete bounded score matrix, rejects incomplete/duplicate/unknown entries and labels the values speculative. No live model call is required for the default demo.

Evaluation compares implementations over available inputs. It is not an offline labelled evaluation, randomised trial or forecasting benchmark. Record mode, candidate universe and evidence timestamp with every comparison. An unavailable provider must remain an unavailable row, not a silently invented result. Do not claim Qloo outperforms baselines based on synthetic data.

## Persistence and concurrency

The default memory store keeps each anonymous session in the API process and serializes updates per session. It is ephemeral. The optional PostgreSQL store keeps the canonical JSON snapshot and normalised projections inside a transaction, using a session row lock for updates. Startup runs the included idempotent schema migration. Browser sessions are selected by an HTTP-only cookie; there is no cinema-team membership system.

PostgreSQL sessions, films, cohorts, slots, programme versions/items, events, runs and evidence have relational representations. Original version/evidence records are not rewritten by normal repair flows, while status and run/event progress can change. Persistent storage, multi-instance deployment, backup restore and retention need separate operational verification; the local-memory test path proves none of them.

## Security and operational scope

The API applies an explicit Origin allowlist, credentialed CORS, request limits and route-level input schemas. These controls reduce prototype risks but do not supply user authentication, authorization roles, API-key cost isolation, signed approvals, comprehensive penetration testing or production availability guarantees. An anonymous visitor can trigger provider usage when live keys are configured; add appropriate access control and quotas before a public deployment.

Cross-site cookies are browser-policy-sensitive. Read [deployment](deployment.md) before splitting Pages and API hosting. Do not put real personal customer data or confidential rights agreements into the demo without a separate data-handling review.
