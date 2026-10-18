# Rights & Resonance: Devpost submission (draft)

Event: Qloo Agentic Hackathon, theme "Agents, but with taste". Deadline: 30 October 2026, 11:45pm EDT.

Placeholders to replace before submitting: `[LIVE DEMO URL]`, `[REPO URL]`, `[VIDEO URL]`, and the bracketed `[FILL …]` items in the walkthrough and screenshot list.

---

## Submitter notes (delete before pasting)

- **Hosting is not done.** Devpost requires an externally hosted, working demo. The Render blueprint exists (`render.yaml`), but no live deployment has been created or verified. Deploy with `QLOO_API_KEY` set as a secret, check the acceptance list in `docs/deployment.md`, then fill `[LIVE DEMO URL]`.
- **Verified on 18 October 2026:** `pnpm typecheck` clean, `pnpm test` 98/98, Playwright e2e 2/2, and a live single-origin run (generate in QLOO mode → approve → withdraw → repair) in headless Chromium. Still walk the golden path once on the hosted URL before recording.
- **Check provider terms before making the repo public.** `packages/qloo/fixtures/resolved-mappings.json` and `confirmed-mappings.json` contain Qloo entity IDs, and `docs/taste-live-sample.md` contains Qloo tag names and rank statements. Confirm the hackathon terms allow publishing these, or remove them.
- **Confirm the Devpost rules yourself.** The rubric weights, prize detail and the exact submission requirements were taken from secondary sources, because the Devpost rules page returned 403 to the research fetch.
- **Do not show the API key, the `.env` file, `reports/qloo-probe.json`, or the session cookie** in screenshots or the video. Share only `reports/qloo-probe-summary.json` if you need to show probe output.

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

Rights & Resonance is a programming workstation for a single fictional cinema, the Lantern Cinema in Bristol. It has 30 catalogue films, three audience cohorts and four screening slots on 16 and 17 October 2026, with a GBP 1,850 budget.

1. **Live Taste DNA.** For each cohort, the app shows the top cultural theme tags Qloo returns for that cohort's cross-domain seeds (films, books and music artists). Each film shows the shared tags that link it to a cohort, with a source label and timestamp.
2. **Constrained slate generation.** A deterministic solver picks four films that satisfy rights availability, territory, licence date window, runtime, format, non-overlapping slots and budget. Its objective serves the least-covered cohort first, using Qloo affinity percentiles over a fixed 30-film universe.
3. **Explicit approval.** Generating a programme creates a draft. A person approves that exact version. Generation never approves anything.
4. **Repair when inputs change.** If a selected film's rights are withdrawn, the approved version is invalidated, a repair draft is generated with minimal slot changes, and the diff is shown. The replacement must also be approved by a person.
5. **Honest labelling.** Every evidence source is labelled: `QLOO` (live), `DEMO` (synthetic) or `UNAVAILABLE`. Missing data is shown as unknown, never as zero.

---

## How we built it

Qloo is load-bearing in this product. The taste evidence drives the cohort profiles, the film "why" lines, and the solver's objective. Without live Qloo data, the app falls back to a labelled synthetic demo, and the Qloo-specific claims do not apply.

### Qloo workflow

All Qloo calls are made server-side through the official `@qloo/qloo-harness` (pinned at 0.1.26), using its `qloo api` route against `https://hackathon.api.qloo.com`. The API key is read only from the server's `QLOO_API_KEY` environment variable and sent as `X-Api-Key`. The browser never sees it, and no personal data is sent.

| Qloo call | Purpose | Why it fits |
| --- | --- | --- |
| `GET /search` (types: movie, book, music artist) | Resolve each catalogue film and each cross-domain cohort seed to a Qloo entity ID. | Titles are ambiguous. A film maps automatically only on a unique normalised title and release-year match. Anything else needs a person to confirm it. |
| `GET /entities?entity_ids=…` | Re-verify each confirmed ID and its type, then fetch the film's theme tags. | Confirms the exact requested set. It also gives tags that can be compared with cohort tags. |
| `GET /v2/insights?filter.type=urn:tag` with `signal.interests.entities` = cohort seeds, `filter.tag.types=urn:tag:theme:qloo`, `filter.parents.types=urn:entity:movie` | Build each cohort's taste profile as a ranked list of theme tags (top 50 retained, top 8 shown). | Cross-domain seeds (a novel, a musician, a film) produce cohort-level themes, not one domain's genre labels. Theme tags read as human-readable concepts. |
| `GET /v2/insights?filter.type=urn:entity:movie` with `signal.interests.entities` = cohort seeds, `filter.results.entities` = the fixed 30-film UUID list, `feature.explainability=true`, `take=30` | Score every catalogue film for each cohort, then compute within-cohort percentiles. | Every cohort scores the same fixed universe, so percentiles are comparable across cohorts. Films that are themselves seeds are reported as unknown, not as zero. |

Our live probe on 18 October 2026 passed all four feasibility gates: 30 of 30 films mapped, 9 of 9 seeds resolved, and three complete cohort profiles over the same universe. Pairwise mean absolute percentile differences were 0.29, 0.32 and 0.15, with different top-five sets. A full probe run makes roughly 45 provider calls. A cold Taste DNA load makes 7 requests and is then cached in process for 15 minutes.

### Application architecture

- **Server:** Fastify API with session isolation. Orchestration runs as a bounded, acyclic LangGraph workflow: load, validate, collect evidence, solve, verify, save draft.
- **Solver:** exhaustive deterministic search over at most 30 films, four slots and three cohorts. It returns a complete feasible slate or an explicit failure. It never returns a partial slate silently.
- **Evidence:** each Qloo observation keeps its endpoint, request hash, response hash, fetch time, serve time, attempts, HTTP status and transport. Solver inputs are stored in an immutable snapshot linked to the version.
- **Front end:** React and Vite, with TanStack Query for server state and Zustand for local UI state.

---

## Request-to-result walkthrough (redacted)

This is one request, traced from the seed names to the programme. Entity IDs, API keys, session cookies and raw payloads are omitted.

**1. Seeds in.** Each cohort has seeds of mixed type. Examples from the fixture include the films *In the Mood for Love* and *Blade Runner*, and the books *Normal People* and *Just Kids*. Seed IDs are resolved with `/search`, one type per seed. All 9 seeds resolved.

**2. Catalogue mapping.** Each of the 30 catalogue films is searched with `types=urn:entity:movie`. Most map automatically on a unique title and year match. Five cases were ambiguous, because Qloo holds duplicate records (two 2022 *Aftersun* records and two *Just Kids* book records, for example). Those were confirmed by a person, who checked name, year, director and type. Each confirmed ID is then re-verified through `/entities`. Result: 30 of 30 films mapped.

**3. Cohort taste profile.** For the Film Society cohort, the app calls `/v2/insights` with `filter.type=urn:tag`, the cohort's seed IDs as interest signals, and `filter.tag.types=urn:tag:theme:qloo`. The top themes came back as *Emotional Growth* (weight 1.00), *Self-Sufficiency* (0.998) and *Dreams Vs Reality* (0.982). Weights are relative within that cohort's top-50 pool. The app does not show them as probabilities.

**4. Why these tags, not others.** We tested tag types before choosing one. `urn:tag:keyword:media` returned noisy trivia. `urn:tag:audience:qloo` returned generic labels such as "Teen-Oriented". `urn:tag:theme:qloo` returned short, cross-domain concepts, so Taste DNA uses themes only. Without the tag-type filter, results mixed places, music and amenities.

**5. Film ranking.** The app calls `/v2/insights` with `filter.type=urn:entity:movie`, the same cohort seeds, and the fixed list of 30 film UUIDs as `filter.results.entities`. Each film gets a raw affinity per cohort, which becomes a percentile over the full universe (the ascending midrank divided by N minus 1). Seed films are absent from their own cohort's response, so they are recorded as `null` and excluded from that cohort's percentile calculation. They are never scored as 0.

**6. Why-line.** Each film's explanation is a fixed template over real shared tags and Qloo's rank in the best-ranking cohort. It is not model-generated. For example, from the live sample: *Aftersun* "Shares the Qloo themes 'memory' with Film Society, where Qloo ranks it #17 of 29 candidate films". The rank comes from Qloo, and the shared tag comes from the film's and cohort's Qloo tag lists. The sentence itself is ours.

**7. Solver.** The solver receives the percentiles and the synthetic rights ledger (rights, fees, territory and dates are synthetic in this build). It maximises, in order: the minimum cohort coverage (mean of each cohort's best two selected films), mean coverage, metadata diversity (distinct genres plus countries), budget savings, and then a deterministic tie-break.

**8. Effect on the slate.** Recorded live QLOO-mode run (18 October 2026): **Akira, Her, Moonlight, Portrait of a Lady on Fire**. Licence cost £1,825 of £1,850. Rank-based cohort coverage: Film Society 98%, Alternative Music 90%, Gaming & Speculative Fiction 89% (minimum 89%). Against the synthetic DEMO slate (Aftersun, Akira, Her, Sound of Metal), live Qloo evidence swapped in Moonlight (Qloo themes 'isolation', 'identity', 'addiction'; ranked #11 of 30 for Alternative Music) and Portrait of a Lady on Fire (theme 'memory'; ranked #1 of 29 for Film Society). Seed films (In the Mood for Love for Film Society, Blade Runner for Gaming) are left unscored for their own cohort, never zero-filled.

**9. Repair.** After approval, withdrawing the rights to *Her* invalidated the approved version. The repair draft (v2) swapped in *Pan's Labyrinth* (£1,800 total), reusing cached evidence with no extra Qloo calls. Minimum coverage moved from 89% to 83%, and the diff shows this before anyone re-approves.

---

## Challenges

- **Entity resolution is not automatic.** Qloo holds duplicate catalogue records, and titles alone are ambiguous. We do not pick the first search hit. Only a unique normalised title-and-year match maps automatically. Five cases were resolved by a person and then re-verified through `/entities`.
- **Qloo omits seed entities from insights results.** A film that is also a cohort seed does not appear in that cohort's response. Treating the absence as zero would bias the ranking, so the app stores it as unknown and excludes it from that cohort's percentiles.
- **Response shapes differed from our first reading of the docs.** Live `/search` and `/entities` return a bare `results` array with no `success` key. The parser accepts that for those endpoints, still rejects `success:false`, and still requires `success:true` for insights.
- **Tag types have very different quality.** Picking the wrong tag type would have put noisy or generic labels in front of users. We chose themes after comparing the options.
- **Comparable scores need a fixed universe.** If a rights withdrawal removed a film from the denominator, coverage could appear to improve for no real reason. Rankings are always computed over the same 30 films, and rights are applied afterwards.

---

## Accomplishments

- A live probe passing all four gates on the Qloo hackathon origin, with the official harness: 30 of 30 films, 9 of 9 seeds, three complete and distinct cohort profiles.
- Taste DNA and film why-lines built only from real Qloo tags and ranks, with a labelled fallback when no key is present. The app never makes up live data.
- A missing or incomplete Qloo response blocks a live solve and is shown as unavailable. It is never converted into a plausible-looking slate.
- Repair that keeps the original approved version, its evidence and its history, and that never re-approves a replacement automatically.
- A zero-key path that still works: DEMO mode runs the full generate, approve, withdraw, repair and export workflow with no network calls.

---

## What we learned

- Qloo's value depends on choosing the right entity types and tag types. A cross-domain seed set gives a useful cohort profile only when the tag filter keeps themes and drops noisy categories.
- Percentiles are only comparable when the candidate universe is fixed, and the universe has to be stated in the output.
- Not having a score is different from having a score of zero, and the system has to keep those apart all the way to the UI.
- Affinity is a useful ordering signal. It is not a forecast of attendance, and the interface has to say so.

---

## What's next

- Replace the synthetic rights ledger with an authorised rights source, starting with one real distributor feed, before any real programming decision.
- Add the natural-language brief that was deferred, so a programmer can describe an audience in words. Qloo's `find_tags` and `describe` would resolve those terms, and a person would confirm any ambiguous ones.
- Add accounts, roles and approval identity, plus per-user quotas, so a public deployment cannot spend the shared key without limit.
- Persist state in PostgreSQL in a verified deployment.
- Repeat the live probe on a schedule and record how stable the rankings are across runs.

---

## Built with

- TypeScript (strict), Node.js 22.19 or newer, pnpm 10.18.3
- Qloo: `@qloo/qloo-harness` 0.1.26 (official), hackathon Insights, Search and Entities endpoints
- Fastify (API), LangGraph (bounded workflow), Zod (schemas)
- React, Vite, TanStack Query, Zustand (web)
- Vitest (tests), Playwright (browser suite, configured)
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

Open http://localhost:5173. The app starts in DEMO mode. Choose DEMO to run the full workflow without a key.

To enable live Qloo evidence, edit `.env` and add these server-side values. Keep the file out of git and never prefix any key with `VITE_`:

```dotenv
QLOO_API_KEY=<your-hackathon-key>
QLOO_BASE_URL=https://hackathon.api.qloo.com
QLOO_TRANSPORT=harness
```

Check the harness without making a provider call, then run the probe:

```sh
pnpm --filter @rr/qloo exec qloo --version
pnpm --filter @rr/qloo exec qloo api --help
pnpm probe
```

`pnpm probe` writes `reports/qloo-probe.json`, which contains raw provider evidence and must stay private. Share only `reports/qloo-probe-summary.json`. Restart `pnpm dev` after changing `.env`. Without a key, the probe reports `UNVERIFIED` and exits with code 2, which is the expected result.

Verify the build:

```sh
pnpm test
pnpm typecheck
pnpm build
```

---

## Known limitations and what this does not establish

**Synthetic inputs.**

- Rights, licence fees, territories, screening windows and film metadata are synthetic. The app does not hold any real licence, and nothing in it is a rights clearance or a contract with a rights holder.
- The three cohorts are fictional. They are group taste profiles, not customer records or demographic segments.

**What the Qloo evidence does not show.**

- It does not show attendance, ticket sales, revenue or any other commercial outcome.
- It does not predict whether a person will attend or buy. Affinity is a relative, within-cohort ordering signal.
- It does not show that Qloo beats any baseline. We have not run a controlled comparison. The Evaluation lab compares modes on the same fixture, and its output is exploratory, not a benchmark.
- It does not measure the true audience of any cinema. The three cohorts are seeded from a handful of cross-domain entities.

**Scope and validation.**

- One live probe run was recorded on 18 October 2026. Its stability over time and across seed changes is not measured.
- The film catalogue is fixed at 30 films, the solver is bounded to four slots and three cohorts, and one cinema is modelled.
- Seeds that are also catalogue films are reported as unknown, not scored. The cohort with such a seed has one fewer comparable film.
- Qloo's per-entity explanations are present in the insights responses we observed. The app's why-lines do not use them; they are templates over shared tags and rank. Explainability availability for each cohort should be checked with the separate probe check before any explanation-dependent demonstration.
- Diversity is a simple count of distinct genres and countries. Release-year spread and franchise concentration are not optimised.
- The Qloo quota and rate limit are not published in the kit. The app keeps calls bounded, with three attempts at most and a 15-minute cache, but a public deployment still needs its own quotas.

**Product and security.**

- Sessions are anonymous, and approval is an in-app action, not verified identity. There is no account system, role model or signed audit record.
- A public deployment with a live key lets any visitor spend the shared quota. Add access control and quotas before opening it.
- The "agent" is a bounded, deterministic workflow. No language model is used in the live path, and no model output can grant rights, change the budget or approve a programme.
- Browser end-to-end tests were not run successfully in the build environment. The unit and HTTP workflow tests are the verified checks.
- The hosted deployment is prepared but not verified on a live account.

---

## Screenshots (placeholders)

Capture these from the hosted demo in QLOO mode. Crop out the session cookie, any key or `.env` content, and any raw JSON.

1. **Taste DNA panel.** Shows the `QLOO_LIVE` source label, the three cohort theme lists and their timestamp. [SCREENSHOT 1]
2. **Programme canvas, QLOO mode.** Shows the draft, four screenings, licence cost and per-cohort coverage. [SCREENSHOT 2]
3. **Why-this-film block.** Shows one film's shared tags and its Qloo rank, with the rank labelled as Qloo's. [SCREENSHOT 3]
4. **Evidence view.** Shows the source, endpoint, fetch time and hashes for one film and cohort. [SCREENSHOT 4]
5. **Approval.** Shows the approved version identified before and after approval. [SCREENSHOT 5]
6. **Rights withdrawal and invalidation.** Shows the change event and the invalidated version. [SCREENSHOT 6]
7. **Repair review.** Shows the diff between the original and the repaired draft, with cost and coverage. [SCREENSHOT 7]
8. **Limitations panel or footer.** Shows the synthetic-rights label. [SCREENSHOT 8]

---

## Demo video script (2:30)

Record against the hosted app in QLOO mode, with the browser window showing `[LIVE DEMO URL]`. Keep the terminal and `.env` out of frame.

| Time | Shot | Voiceover |
| --- | --- | --- |
| 0:00–0:15 | Title card, then the Programme canvas in DEMO label state. | "Cinema programmers choose a slate from instinct and catalogues. They rarely see how it serves different audience groups, or why each film was picked. Rights & Resonance is a workstation that tries to show that." |
| 0:15–0:40 | Open Taste DNA. Show the `QLOO_LIVE` label, the timestamp and the top themes for one cohort. | "These are live theme tags from Qloo for three fictional cohorts. Each cohort is seeded from a film, a book and a musician. The weights are relative within a cohort. They are not predictions." |
| 0:40–1:05 | Click **Generate programme** in QLOO mode. Show the draft, four screenings and the coverage numbers. | "Generation creates a draft. The solver uses rights, budget, runtime, format and time constraints as hard limits. It serves the least-covered cohort first. The rights here are synthetic." |
| 1:05–1:25 | Open one film's why-line and its evidence view. | "This line is a template over tags Qloo returned for both the film and the cohort, plus Qloo's rank. The sentence is ours. The rank is Qloo's. Nothing here is written by a model." |
| 1:25–1:40 | Click **Approve programme**. Point to the approved version identifier. | "A person approves the exact version. Approval is an explicit action, and this prototype does not treat it as a contract." |
| 1:40–1:58 | Open a selected film's rights panel and choose **Withdraw rights & repair**. Show the invalidated status. | "Now I withdraw the rights for one selected film. That is a simulated ledger change. The approved version is invalidated, and the original stays in history." |
| 1:58–2:15 | Open **Repair review**. Show the diff: kept films, the replacement, cost and coverage. Approve the repair. | "The repair keeps as many films as it can and changes the fewest slots first. The replacement is a new draft with its own evidence. It only becomes a programme after I approve it." |
| 2:15–2:30 | Show the limitations panel, then the synthetic-rights and not-attendance statements. | "Qloo gives us relative taste evidence, not attendance or sales. The rights, fees and cohorts here are synthetic. The probe passed its feasibility gates, and that is all it establishes. Code and setup are at [REPO URL]. Thanks for watching." |

Recording notes:

- Keep the total under 2:30. Trim the Taste DNA shot first if needed.
- Do not show the API key, `.env`, the session cookie or any raw JSON.
- If the live API is unavailable during recording, say so in the voiceover and use the DEMO path. Label it as DEMO.

Video link: [VIDEO URL]
