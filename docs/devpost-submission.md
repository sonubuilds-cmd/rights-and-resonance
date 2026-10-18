# Rights & Resonance: Devpost submission

Event: Qloo Agentic Hackathon, theme "Agents, but with taste". Deadline: 30 October 2026, 11:45pm EDT.

Placeholders to replace before submitting: `[LIVE DEMO URL]`, `[REPO URL]`, `[VIDEO URL]`, and the bracketed `[SCREENSHOT n]` items.

---

## Eligibility at a glance

**Project status.** Created during the submission period. First commit 2 October 2026; the period opened 30 September 2026. No code predates the period.

### Stage One (pass/fail): met under (a) and (c)

| Rule | How this project meets it |
| --- | --- |
| **(a) Functions as an agentic tool** | Ten agent tools (`get_workspace` to `export_programme`) run behind two front doors: the in-app **Programming agent** and an MCP server at `[LIVE DEMO URL]/mcp`. |
| **(b) Built using an agent framework** | Not claimed. The in-app agent is a Gemini function-calling loop written directly against the REST API, with no agent framework. |
| **(c) Integrates Qloo into an existing agent** | Existing MCP clients connect to the same tools, for example Claude Code (`claude mcp add --transport http rights-resonance [LIVE DEMO URL]/mcp`) and Claude Desktop. |

### Criterion 1: Technological Implementation

- **Four Qloo endpoints in use.** `/search` resolves films and cross-domain seeds. `/entities` re-verifies IDs and fetches theme tags. `/v2/insights` builds cohort theme profiles (theme tags only). `/v2/insights` scores all 30 films per cohort with explainability on.
- **Live gate passed on 18 October 2026** against `hackathon.api.qloo.com`: **30/30 films mapped, 9/9 cross-domain seeds resolved, 3 complete and distinct cohort profiles.**
- **Non-trivial working code.** Constrained solver, immutable evidence snapshots with request and response hashes, a server-enforced approval gate, an MCP server with per-session isolation, and 139 unit/integration tests plus 3 Playwright end-to-end tests.

### Criterion 2: Design

- **A complete product, not a proof of concept.** Programming agent, Taste DNA, programme canvas, evidence view, approval, rights withdrawal, repair review with diff, export, and an "Agent access" page for MCP.
- **Every number carries its source.** Badges read QLOO LIVE, DEMO or UNAVAILABLE. Missing data is shown as unknown, never as zero.
- **Runs with no keys.** DEMO mode runs the full generate, approve, withdraw, repair and export workflow, so judges can test it without setup.

### Criterion 3: Potential Impact

- **Real audience.** Independent cinema programmers who choose one slate for several communities, under a fixed licence budget, while rights change after the slate is agreed.
- **Specific pain.** When a licence falls through, the usual fix is to rebuild the slate by hand. Here the agent changes the fewest slots, shows the diff with cost and coverage moves, and waits for a person to re-approve.
- **Honest scope.** One fictional cinema (The Lantern, Bristol). Rights and fees are synthetic. A real pilot would need an authorised rights feed first (see "What's next").

### Criterion 4: Quality of the Idea

- **Cross-domain taste seeds.** Each audience is seeded with a film, a book and a music artist. Qloo's theme tags then describe a group's shared taste, not one genre label.
- **Comparable scores.** All films are scored over one fixed universe, so percentiles compare fairly across audiences. A seed film is marked unknown for its own audience, not zero.
- **Division of labour.** The agent proposes and explains. The solver chooses films under hard constraints. A person approves. A repair keeps the original approved version in history.

---

## Tagline (60 characters or fewer)

1. **Agents, but with taste: a cinema programme with receipts** (56 characters)
2. **Cinema slates built from cultural taste evidence** (48 characters)
3. **Qloo-backed programming with rights and approval built in** (56 characters)

---

## Inspiration

Cinema programmers pick a slate from a mix of instinct, distributor catalogues and what sold last time. Three things are usually missing from that process:

- Evidence about how a slate serves different audience groups, rather than one average audience.
- A record of why each film was chosen, which holds up when someone asks later.
- A way to recover when a licence is withdrawn after a slate has been approved.

We wanted an agent-shaped workflow that uses real cultural taste data from Qloo as evidence, keeps a person in charge of the decision, and repairs the programme transparently when its inputs change. "Taste" here means relative affinity between a fictional audience group and a film. It does not mean a prediction about any individual.

---

## What it does

**Start with the Programming agent.** Type a goal, for example:

> *Plan a two-night season at the Lantern for our three audiences, explain each pick with Qloo themes, then tell me what happens if the rights to Her fall through.*

The agent calls the tools in turn and shows each step with its provenance badge:

1. `get_taste_dna` returns live Qloo themes for each audience (QLOO LIVE).
2. `generate_programme` runs the solver and returns a draft (not approved).
3. `explain_film` gives each pick's rank per audience and the Qloo themes it shares.
4. The agent asks for approval. A **Confirm approval** button records it. The model cannot approve on its own.
5. If you then report that a licence has fallen through, `withdraw_rights` invalidates the approved version. The agent runs the repair and shows the diff for you to review.

**The workstation behind the agent** is for a single fictional cinema, the Lantern Cinema in Bristol. It has 30 catalogue films, three audience cohorts, four screening slots on 16 and 17 October 2026, and a budget of GBP 1,850.

1. **Live Taste DNA.** For each cohort, the top theme tags Qloo returns for its cross-domain seeds. Each film shows the shared tags that link it to a cohort, with a source label and timestamp.
2. **Constrained slate generation.** The solver picks four films that satisfy rights availability, territory, licence window, runtime, format, non-overlapping slots and budget. It serves the least-covered cohort first, using Qloo affinity percentiles over the fixed 30-film universe.
3. **Explicit approval.** Generating a programme creates a draft. A person approves that exact version. Generation never approves anything.
4. **Repair when inputs change.** If a selected film's rights are withdrawn, the approved version is invalidated. A repair draft is generated with the fewest slot changes, and the diff is shown. The replacement also needs a person's approval.
5. **Honest labelling.** Every evidence source is labelled QLOO (live), DEMO (synthetic) or UNAVAILABLE. Missing data is shown as unknown.
6. **Use it from any agent.** The same ten tools are served over MCP, so Claude Code or Claude Desktop can run the same workflow.

### What decides what

| Part | Type | Role |
| --- | --- | --- |
| Programming agent (Gemini, or any MCP client) | Model-driven | Plans, calls tools, explains results and asks for approval. |
| Solver | Deterministic | Picks the films and enforces every constraint. The model cannot override rights, format, runtime or budget. |
| Why-lines | Deterministic templates | A fixed sentence filled with real shared Qloo tags and Qloo's rank. No model writes them. |
| Approval | Human | Only a person's explicit action (the Confirm approval button, or a confirmed MCP call) approves a version. |

---

## How we built it

Qloo is load-bearing in this product. Taste evidence drives the cohort profiles, the film "why" lines, the solver objective and the agent's explanations. Without live Qloo data, the app falls back to a labelled synthetic DEMO, and the Qloo-specific claims do not apply.

### Qloo workflow

Qloo calls are made server-side only. The API key is read from the server's `QLOO_API_KEY` environment variable and is never sent to the browser. No personal data is sent.

**Transport.** Local development and the live gate use the official `@qloo/qloo-harness` 0.1.26 (`QLOO_TRANSPORT=harness`, the default). The hosted Render demo uses direct HTTPS to the same hackathon origin (`QLOO_TRANSPORT=direct-http`, set in `render.yaml`). The reason is practical: the harness takes about 20 seconds to cold-load on the 0.1 CPU free tier, which breaks interactive use. The choice is explicit. The two transports never switch automatically.

| Qloo call | Purpose | Why it fits |
| --- | --- | --- |
| `GET /search` (types: movie, book, music artist) | Resolve each catalogue film and each cross-domain cohort seed to a Qloo entity ID. | Titles are ambiguous. A film maps automatically only on a unique normalised title and release-year match. Anything else needs a person to confirm it. |
| `GET /entities?entity_ids=...` | Re-verify each confirmed ID and its type, then fetch the film's theme tags. | Confirms the exact requested set. It also gives tags that can be compared with cohort tags. |
| `GET /v2/insights?filter.type=urn:tag` with `signal.interests.entities` = cohort seeds, `filter.tag.types=urn:tag:theme:qloo`, `filter.parents.types=urn:entity:movie` | Build each cohort's taste profile as a ranked list of theme tags (top 50 kept, top 8 shown). | Cross-domain seeds (a novel, a musician, a film) produce cohort-level themes, not one domain's genre labels. |
| `GET /v2/insights?filter.type=urn:entity:movie` with the cohort seeds, `filter.results.entities` = the fixed 30-film UUID list, `feature.explainability=true`, `take=30` | Score every catalogue film for each cohort, then compute within-cohort percentiles. | Every cohort scores the same universe, so percentiles are comparable. Films that are themselves seeds are reported as unknown, not zero. |

**Live gate, 18 October 2026:** 30 of 30 films mapped, 9 of 9 seeds resolved, three complete cohort profiles over the same universe. Pairwise mean absolute percentile differences were 0.29, 0.32 and 0.15, with different top-five sets. A full probe makes roughly 45 provider calls. A cold Taste DNA load makes 7 requests and is cached in process for 15 minutes.

### Agent layer

- **One tool registry, two front doors.** `apps/api/src/agent-tools.ts` defines ten tools. Both the in-app agent and the MCP server call the same code, which uses the same workspace logic as the REST routes. There is no second implementation.
- **Programming agent.** Gemini function calling over REST (no SDK). A bounded tool loop runs up to 8 rounds per message. Each step is recorded in a trace with its tool, sanitised arguments, outcome and provenance, and shown in the UI.
- **Approval gate, enforced by the server.** `approve_programme` is declared to Gemini without the `userConfirmed` field. When the model calls it, the server returns `APPROVAL_REQUIRED` and records a pending approval. Only the **Confirm approval** button, which posts the exact version ID, approves it. Typing "yes, approve" in chat does nothing.
- **MCP server.** Streamable HTTP at `/mcp`, plus a local stdio entry. Each MCP session gets its own in-memory workspace. It exposes two prompts, `plan_season` and `handle_rights_change`.

### Application architecture

- **Server:** Fastify API with session isolation. The slate-generation pipeline is a bounded, acyclic LangGraph workflow: load, validate, collect evidence, solve, verify, save draft.
- **Solver:** exhaustive deterministic search over at most 30 films, four slots and three cohorts. It returns a complete feasible slate or an explicit failure, never a silent partial slate.
- **Evidence:** each Qloo observation keeps its endpoint, request hash, response hash, fetch and serve times, attempts, HTTP status and transport. Solver inputs are stored in an immutable snapshot linked to the version.
- **Front end:** React and Vite, with TanStack Query for server state and Zustand for local UI state.

---

## Request-to-result walkthrough (redacted)

This is one request, traced from the seed names to the programme. Entity IDs, API keys, session cookies and raw payloads are omitted.

**1. Seeds in.** Each cohort has seeds of mixed type. Examples from the fixture include the films *In the Mood for Love* and *Blade Runner*, and the books *Normal People* and *Just Kids*. Seed IDs are resolved with `/search`, one type per seed. All 9 seeds resolved.

**2. Catalogue mapping.** Each of the 30 catalogue films is searched with `types=urn:entity:movie`. Most map automatically on a unique title and year match. Five cases were ambiguous, because Qloo holds duplicate records (two 2022 *Aftersun* records and two *Just Kids* book records, for example). A person confirmed those after checking name, year, director and type. Each confirmed ID is then re-verified through `/entities`. Result: 30 of 30 films mapped.

**3. Cohort taste profile.** For the Film Society cohort, the app calls `/v2/insights` with `filter.type=urn:tag`, the cohort's seed IDs as interest signals, and `filter.tag.types=urn:tag:theme:qloo`. The top themes came back as *Emotional Growth* (weight 1.00), *Self-Sufficiency* (0.998) and *Dreams Vs Reality* (0.982). Weights are relative within that cohort's top-50 pool. The app does not show them as probabilities.

**4. Why these tags.** We tested tag types before choosing one. `urn:tag:keyword:media` returned noisy trivia. `urn:tag:audience:qloo` returned generic labels such as "Teen-Oriented". `urn:tag:theme:qloo` returned short, cross-domain concepts, so Taste DNA uses themes only. Without the tag-type filter, results mixed places, music and amenities.

**5. Film ranking.** The app calls `/v2/insights` with `filter.type=urn:entity:movie`, the same cohort seeds, and the fixed list of 30 film UUIDs as `filter.results.entities`. Each film gets a raw affinity per cohort, which becomes a percentile over the full universe (ascending midrank divided by N minus 1). Seed films are absent from their own cohort's response, so they are recorded as unknown and excluded from that cohort's percentiles. They are never scored as 0.

**6. Why-line.** Each film's explanation is a fixed template over real shared tags and Qloo's rank in the best-ranking cohort. It is not model-generated. For example, from the live sample: *Aftersun* "Shares the Qloo themes 'memory' with Film Society, where Qloo ranks it #17 of 29 candidate films". The rank comes from Qloo, and the shared tag comes from the film's and the cohort's Qloo tag lists. The sentence itself is ours.

**7. Solver.** The solver receives the percentiles and a synthetic rights ledger (rights, fees, territories and dates are synthetic in this build). It maximises, in order: the minimum cohort coverage (mean of each cohort's best two selected films), mean coverage, metadata diversity (distinct genres plus countries), budget savings, and then a deterministic tie-break.

**8. Effect on the slate.** Recorded live QLOO-mode run (18 October 2026): **Akira, Her, Moonlight, Portrait of a Lady on Fire**. Licence cost £1,825 of £1,850. Rank-based cohort coverage: Film Society 98%, Alternative Music 90%, Gaming & Speculative Fiction 89% (minimum 89%). Against the synthetic DEMO slate (Aftersun, Akira, Her, Sound of Metal), live Qloo evidence swapped in Moonlight (Qloo themes 'isolation', 'identity', 'addiction'; ranked #11 of 30 for Alternative Music) and Portrait of a Lady on Fire (theme 'memory'; ranked #1 of 29 for Film Society). Seed films (In the Mood for Love for Film Society, Blade Runner for Gaming) are left unscored for their own cohort, never zero-filled.

**9. Repair.** After approval, withdrawing the rights to *Her* invalidated the approved version. The repair draft (v2) swapped in *Pan's Labyrinth* (£1,800 total), reusing cached evidence with no extra Qloo calls. Minimum coverage moved from 89% to 83%, and the diff shows this before anyone re-approves.

**10. Through the agent or MCP.** The same tools run in the same order whether the Programming agent or an MCP client asks for them. Each call appears in the trace with its provenance.

---

## Challenges

- **Entity resolution is not automatic.** Qloo holds duplicate catalogue records, and titles alone are ambiguous. We do not pick the first search hit. Only a unique normalised title-and-year match maps automatically. Five cases were resolved by a person and then re-verified through `/entities`.
- **Qloo omits seed entities from insights results.** A film that is also a cohort seed does not appear in that cohort's response. Treating the absence as zero would bias the ranking, so the app stores it as unknown and excludes it from that cohort's percentiles.
- **Response shapes differed from our first reading of the docs.** Live `/search` and `/entities` return a bare `results` array with no `success` key. The parser accepts that for those endpoints, still rejects `success:false`, and still requires `success:true` for insights.
- **Tag types have very different quality.** Picking the wrong tag type would have put noisy or generic labels in front of users. We chose themes after comparing the options.
- **Comparable scores need a fixed universe.** If a rights withdrawal removed a film from the denominator, coverage could appear to improve for no real reason. Rankings are always computed over the same 30 films, and rights are applied afterwards.
- **The agent must not approve.** Approval is not something the model can satisfy with a plausible argument. The tool is withheld from the model's approval path, and a model attempt returns `APPROVAL_REQUIRED` until a person clicks **Confirm approval**.
- **Free hosting.** The harness cold start on a 0.1 CPU instance is too slow for interactive use, so the hosted demo uses direct HTTPS to the same origin. The first load after idle also takes about a minute.

---

## Accomplishments

- A live gate passed on the Qloo hackathon origin: 30 of 30 films, 9 of 9 seeds, and three complete, distinct cohort profiles.
- A Programming agent and an MCP server that share one tool registry, so the agent and an external client produce the same results.
- Taste DNA and film why-lines built only from real Qloo tags and ranks, with a labelled fallback when no key is present. The app never makes up live data.
- A missing or incomplete Qloo response blocks a live solve and is shown as unavailable. It is never turned into a plausible-looking slate.
- Repair that keeps the original approved version, its evidence and its history, and never re-approves a replacement automatically.
- A zero-key path: DEMO mode runs the full workflow with no network calls.
- 139 unit and integration tests and 3 Playwright end-to-end tests.

---

## What we learned

- Qloo's value depends on choosing the right entity types and tag types. A cross-domain seed set gives a useful cohort profile only when the tag filter keeps themes and drops noisy categories.
- Percentiles are only comparable when the candidate universe is fixed, and the universe has to be stated in the output.
- Not having a score is different from having a score of zero. The system keeps those apart all the way to the UI and to the agent's answers.
- Affinity is a useful ordering signal. It is not a forecast of attendance, and the interface has to say so.
- A tool-using model is only as trustworthy as its tools' guardrails. Putting the approval gate on the server, not in the prompt, was the decision that made the agent safe to demonstrate.

---

## What's next

- Replace the synthetic rights ledger with an authorised rights source, starting with one real distributor feed, before any real programming decision.
- Add a natural-language brief, so a programmer can describe an audience in words. Qloo's `find_tags` and `describe` would resolve those terms, and a person would confirm any ambiguous ones.
- Add accounts, roles and approval identity, plus per-user quotas, so a public deployment cannot spend the shared key without limit.
- Persist state in PostgreSQL in a verified deployment.
- Repeat the live probe on a schedule and record how stable the rankings are across runs.

---

## Built with

- TypeScript (strict), Node.js 22.19 or newer, pnpm 10.18.3
- Qloo: `@qloo/qloo-harness` 0.1.26 (official, local and gate) and direct HTTPS to the hackathon Insights, Search and Entities endpoints (hosted demo)
- Google Gemini function calling (REST, no SDK) for the Programming agent
- Model Context Protocol (Streamable HTTP and stdio) via `@modelcontextprotocol/sdk`
- Fastify (API), LangGraph (generation workflow), Zod v4 (schemas and tool input validation)
- React, Vite, TanStack Query, Zustand (web)
- Vitest (139 tests), Playwright (3 end-to-end tests)
- PostgreSQL (optional persistence)
- Docker, Render (single-service deployment blueprint)

---

## Setup from a clean environment

Requirements: Node.js 22.19.0 or newer, and `corepack`. No API key is needed for DEMO mode.

```sh
git clone [REPO URL] rights-and-resonance
cd rights-and-resonance
corepack enable
corepack prepare pnpm@10.18.3 --activate
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Open http://localhost:5173. The app starts in DEMO mode, and you can run the full workflow without a key.

**Optional: live Qloo evidence.** Add these server-side values to `.env`. Keep the file out of git, and never prefix a key with `VITE_`:

```dotenv
QLOO_API_KEY=<your-hackathon-key>
QLOO_BASE_URL=https://hackathon.api.qloo.com
QLOO_TRANSPORT=harness
```

Check the harness without a provider call, then run the probe:

```sh
pnpm --filter @rr/qloo exec qloo --version
pnpm --filter @rr/qloo exec qloo api --help
pnpm probe
```

`pnpm probe` writes `reports/qloo-probe.json`, which holds raw provider evidence and must stay private. Share only `reports/qloo-probe-summary.json`. Without a key, the probe reports `UNVERIFIED` and exits with code 2, which is the expected result.

**Optional: the Programming agent.** Add `GEMINI_API_KEY=<key>` to `.env` (server-only). `GEMINI_MODEL` defaults to `gemini-2.5-flash`. If Google reports the model as unavailable, set `GEMINI_MODEL` to a current model from https://ai.google.dev/gemini-api/docs/models. Without the key, the agent page says it is unavailable and the rest of the app still works.

**Connect an agent over MCP.** Run the app locally (`pnpm dev`, endpoint `http://localhost:3001/mcp`) or use the hosted URL:

```sh
# Claude Code, hosted
claude mcp add --transport http rights-resonance [LIVE DEMO URL]/mcp

# Claude Code, local stdio from a clone of this repo
claude mcp add rights-resonance -- pnpm --silent --dir "$PWD" mcp
```

Claude Desktop: Settings, Connectors, Add custom connector, and paste the `/mcp` URL. Other JSON-config clients use `{ "mcpServers": { "rights-resonance": { "type": "http", "url": "[LIVE DEMO URL]/mcp" } } }`. The web app's **Agent access** page shows copy-ready snippets for the origin you are on.

Verify the build:

```sh
pnpm test
pnpm typecheck
pnpm build
```

### Deploy to Render (free tier)

1. In Render, create a **new Web Service** from this repository, using the **Docker** runtime and the **Free** plan. The `render.yaml` blueprint describes the same setup.
2. Set the health check path to `/healthz`.
3. Set these environment variables:
   - `QLOO_API_KEY`: the hackathon key (secret).
   - `QLOO_BASE_URL`: `https://hackathon.api.qloo.com`.
   - `QLOO_TRANSPORT`: `direct-http` (as in `render.yaml`; see Qloo workflow above for why).
   - `ALLOWED_ORIGINS`: the service's own URL, for example `https://your-service.onrender.com`.
   - `COOKIE_SECURE`: `true`.
   - `PORT`: `3001`.
   - `GEMINI_API_KEY`: optional, enables the Programming agent (secret).
4. Deploy. Open `[LIVE DEMO URL]/healthz`, then load the app. **The first load after idle takes about a minute** while the free instance starts.
5. Walk the golden path once on the hosted URL (generate, approve, withdraw, repair) before recording.

Full details, including the database option and the split-host fallback, are in [docs/deployment.md](docs/deployment.md).

---

## Known limitations and what this does not establish

**Synthetic inputs.**

- Rights, licence fees, territories, screening windows and film metadata are synthetic. The app holds no real licence, and nothing in it is a rights clearance or a contract with a rights holder.
- The three cohorts are fictional. They are group taste profiles, not customer records or demographic segments.

**What the Qloo evidence does not show.**

- It does not show attendance, ticket sales, revenue or any other commercial outcome.
- It does not predict whether a person will attend or buy. Affinity is a relative, within-cohort ordering signal.
- It does not show that Qloo beats any baseline. We have not run a controlled comparison. The Evaluation lab compares modes on the same fixture, and its output is exploratory, not a benchmark.
- It does not measure the true audience of any cinema. The cohorts are seeded from a handful of cross-domain entities.

**Scope and validation.**

- One live probe run is recorded (18 October 2026). Its stability over time and across seed changes is not measured.
- The film catalogue is fixed at 30 films, the solver is bounded to four slots and three cohorts, and one cinema is modelled.
- Seeds that are also catalogue films are reported as unknown, not scored. The cohort with such a seed has one fewer comparable film.
- Qloo's per-entity explanations are present in the insights responses we observed. The app's why-lines do not use them; they are templates over shared tags and rank.
- Diversity is a simple count of distinct genres and countries. Release-year spread and franchise concentration are not optimised.
- The Qloo quota and rate limit are not published in the kit. The app keeps calls bounded (three attempts at most, 15-minute cache), but a public deployment still needs its own quotas.

**The Programming agent.**

- The model chooses which tools to call and writes the prose. It does not choose films, change constraints or approve anything. Its answers are grounded in tool results, and the trace shows each one.
- Requests to Gemini contain the conversation, the tool schemas and tool results. These are synthetic programme data and Qloo aggregates. No personal data is collected or sent. On Gemini's free tier, Google may use submitted content to improve its products. That is acceptable only because nothing sensitive is in the payload.
- Usage is limited per browser session and for the whole deployment, to protect the shared free quota. Conversations are held in memory and are lost on restart.

**Product and security.**

- Sessions are anonymous, and approval is an in-app action, not verified identity. There is no account system, role model or signed audit record.
- A public deployment with live keys lets any visitor spend the shared quota. The MCP and agent endpoints have rate limits, but add access control before opening a keyed deployment widely.
- The hosted deployment runs on a free instance. It sleeps when idle, so the first load takes about a minute.

---

## Screenshots (placeholders)

Capture these from the hosted demo in QLOO mode. Crop out the session cookie, any key or `.env` content, and any raw JSON.

1. **Programming agent trace.** The user goal, then each tool step with its QLOO LIVE badge, and the approval request. [SCREENSHOT 1]
2. **Taste DNA panel.** The QLOO LIVE label, the three cohort theme lists and their timestamp. [SCREENSHOT 2]
3. **Programme canvas.** The draft, four screenings, licence cost and per-cohort coverage. [SCREENSHOT 3]
4. **Why-this-film block.** One film's shared tags and its Qloo rank, labelled as Qloo's. [SCREENSHOT 4]
5. **Confirm approval.** The approval card and the approved version identifier after the click. [SCREENSHOT 5]
6. **Rights withdrawal and repair.** The invalidated version and the repair diff with cost and coverage. [SCREENSHOT 6]
7. **Claude Code over MCP.** The connected server and the same tool steps in the terminal. [SCREENSHOT 7]
8. **Limitations panel or footer.** The synthetic-rights label. [SCREENSHOT 8]

---

## Demo video script (2:30)

Record against the hosted app in QLOO mode, with the browser showing `[LIVE DEMO URL]`. Keep `.env`, the session cookie and any raw JSON out of frame. Recording plan: 0:00 to 0:15 intro, 0:15 to 0:45 plan, 0:45 to 1:05 explanation, 1:05 to 1:30 approval, 1:30 to 1:45 rights change, 1:45 to 2:00 Claude Code, 2:00 to 2:30 limits.

| Time | Shot | Voiceover |
| --- | --- | --- |
| 0:00–0:15 | Title card, then the **Programming agent** with an empty chat. | "Cinema programmers build a slate from instinct and catalogues, and rarely see how it serves different audiences. Rights & Resonance is an agent that plans the season with Qloo taste evidence, and a person approves it." |
| 0:15–0:45 | Type the goal: plan a two-night season, explain each pick with Qloo themes. Show the trace: `get_taste_dna`, `generate_programme`, `explain_film`, each with a **QLOO LIVE** badge. | "The agent calls tools in order. It reads live Qloo themes for three fictional audiences, and the solver picks four films under rights, budget and slot limits. The model does not pick the films." |
| 0:45–1:05 | Open the draft on the canvas. Show the four screenings, cost, coverage and one why-line. | "Each pick has a why-line built from tags Qloo returned for the film and the audience, plus Qloo's rank. The sentence is a template. The rank is Qloo's. The rights here are synthetic." |
| 1:05–1:30 | The agent asks for approval. Click **Confirm approval**. Point to the approved version ID. | "The agent cannot approve. It asks, and I confirm. Approval is a planning decision, not a rights clearance." |
| 1:30–1:45 | Type: "Rights to Her fell through." The trace shows `withdraw_rights` and `repair_programme`. Show the invalidated version. | "Now the rights to one film fall through. The approved version is invalidated, and the original stays in history. The agent runs the repair." |
| 1:45–2:00 | Terminal: `claude mcp add --transport http rights-resonance [LIVE DEMO URL]/mcp`, then the same prompt in Claude Code, and the same tool steps appear. | "The same ten tools are served over MCP. Claude Code runs the same workflow against the same logic." |
| 2:00–2:30 | Repair diff: Her swapped for Pan's Labyrinth, cost and coverage moves. Then the limitations panel. | "The repair changes the fewest slots and waits for approval. Qloo gives us relative taste evidence, not attendance or sales. Rights, fees and audiences here are synthetic. Code and setup are at [REPO URL]. Thanks for watching." |

Recording notes:

- Keep the total under 2:30. If needed, trim the Claude Code segment first, then the Taste DNA detail.
- If the live Qloo or Gemini service is unavailable during recording, say so in the voiceover, switch to DEMO mode and label it as DEMO. Do not present DEMO output as live.
- The recorded run's exact numbers may differ from the example in the walkthrough. Quote what appears on screen.

Video link: [VIDEO URL]

---

## Submitter notes (delete before pasting)

**Checklist before submitting**

1. Deploy the Render service (see Setup) and set `QLOO_API_KEY`, `ALLOWED_ORIGINS`, `COOKIE_SECURE=true`, `PORT=3001`, `QLOO_BASE_URL` and `QLOO_TRANSPORT=direct-http`.
2. Set `GEMINI_API_KEY` on Render, then test a real chat turn in the Programming agent. If the model is reported unavailable, set `GEMINI_MODEL` to a current model.
3. Check the MCP connection with `claude mcp add --transport http ...` against the hosted URL, and run the golden path (generate, approve, withdraw, repair) once.
4. Run `pnpm test` (139 tests) and `pnpm test:e2e` (3 tests) on the commit you submit.
5. Make the repository **public**, and confirm the MIT licence shows in the GitHub **About** panel.
6. Confirm the hackathon terms allow publishing `packages/qloo/fixtures/resolved-mappings.json`, `confirmed-mappings.json` and `docs/taste-live-sample.md`. These contain Qloo entity IDs, tag names and rank statements. Remove them if in doubt.
7. Keep the Render service and the Qloo and Gemini keys active until **16 November 2026**, so judges can use the demo.
8. Record the video (2:30) and upload it. Replace `[VIDEO URL]`.
9. Replace all placeholders: `[LIVE DEMO URL]`, `[REPO URL]`, `[VIDEO URL]`, `[SCREENSHOT n]`.

**Devpost form fields**

- Project name: Rights & Resonance
- Tagline: option 1 above
- Description: sections from "Eligibility at a glance" to "What's next"
- Built with: "Built with" section
- Try it out: `[LIVE DEMO URL]`
- Code: `[REPO URL]`
- Video: `[VIDEO URL]`
- Images: screenshots 1 to 8

**Do not show** the API keys, the `.env` file, `reports/qloo-probe.json`, or the session cookie in screenshots or the video. Share only `reports/qloo-probe-summary.json` if you need to show probe output.
