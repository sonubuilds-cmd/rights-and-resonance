# Qloo hackathon alignment

Checked on **2 October 2026** against the official [Qloo hackathon kit](https://github.com/qloo/qloo-hackathon-kit) at commit [`0db91b8d9c5aae2160d53596e57ea6c9da251cde`](https://github.com/qloo/qloo-hackathon-kit/commit/0db91b8d9c5aae2160d53596e57ea6c9da251cde) (23 September 2026), the published `@qloo/qloo-harness@0.1.26` package, and the [Qloo Agentic Hackathon Developer Guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide#getting-your-api-key). The guide retains `qloo-llm-hackathon` in its URL; its current title is Agentic Hackathon.

This is a source/configuration alignment record. **No real key, authenticated provider result, hosting deployment or submission is certified by it.** The synthetic workstation works separately from the live gate.

## Selected kit surface

The kit offers `qloo explore`, `qloo exec`, `qloo api` and `qloo mcp`. It excludes `integrate`, `plan` and `build` from the event. These are supported integration choices, not a requirement to implement every surface. Rights & Resonance uses **`qloo api`**, because it needs narrowly specified entity lookup and movie Insights requests with a frozen candidate universe. It does not require an MCP server or model-provider login to obtain Qloo data. See the [kit CLI starter](https://github.com/qloo/qloo-hackathon-kit/blob/main/starter/cli-workflow/README.md).

The server adapter invokes the published harness in an isolated, bounded child process without a shell. It supplies only validated command arguments; the key travels in the child environment, never an argument. The default is `QLOO_TRANSPORT=harness`. Setting `QLOO_TRANSPORT=direct-http` explicitly selects the retained HTTP implementation for compatibility/testing. Missing harness, authentication errors and throttling never silently select that transport, another key or another endpoint.

The package is pinned at 0.1.26. The kit minimum is 0.1.26 and Node 22.19.0; the repository and Docker runtime enforce the Node minimum. Upgrading the harness requires rerunning the transport tests.

### Response preservation

The kit describes `qloo api` output as raw API JSON. Inspection of the published 0.1.26 package shows that the relevant JSON commands extract the entity list and can omit the provider envelope. This adapter therefore observes the original response at the isolated harness request boundary, retaining success/partial-response context, status and retry information before the harness formats its CLI output. A bare CLI array is not treated as proof of a successful complete provider response. The official harness still constructs and sends the request; this is not a switch to the compatibility transport.

## Key and endpoint setup

1. Open the API-key request form linked from the [developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide#getting-your-api-key). A finalized project idea is not required. The guide says approved personal keys normally arrive by email within a few business days; check spam, then follow its resubmission guidance if delayed.
2. Use your individually attributable event key. Do not share it between teams or include it in code, screenshots, recordings, model prompts or a public MCP configuration.
3. Supply `QLOO_API_KEY` privately to the API/probe environment. The app intentionally ignores credentials saved by a separate harness setup session, so a local machine's existing credential cannot unexpectedly activate it.
4. Keep `QLOO_BASE_URL=https://hackathon.api.qloo.com`. Both application transports reject other origins. Standalone harness 0.1.26 defaults to `https://api.qloo.com`, so standalone CLI commands also need this explicit environment variable. Hackathon keys do not work with staging or production.

For interactive Bash, one way to provide an existing key without putting its value in shell history is:

```bash
read -r -s -p 'Qloo API key: ' QLOO_API_KEY
printf '\n'
export QLOO_API_KEY
export QLOO_BASE_URL=https://hackathon.api.qloo.com
export QLOO_TRANSPORT=harness
pnpm probe
unset QLOO_API_KEY
```

`pnpm probe` is a **live** action when a key is present and consumes quota. Do not run it merely to check installation. Stop other API processes when removing a key; unsetting a shell variable does not remove it from processes already started.

For independent CLI use, the kit's interactive `qloo setup --qloo` is another supported setup method; it stores a private harness credential. If using the repository's pinned installation, invoke it as `QLOO_BASE_URL=https://hackathon.api.qloo.com QLOO_TRUSTED_BASE_URL=https://hackathon.api.qloo.com pnpm --filter @rr/qloo exec qloo setup --qloo`. The matching trust variable is required because harness 0.1.26 classifies the hackathon host as a custom origin. The app sets both variables internally to this exact origin; it accepts no custom gateway. This setup is an operator action, not performed by this build. It does not configure the app's explicit environment key. Never use an `--api-key` argument with a real key.

## Offline checks before live requests

From the repository root after `pnpm install --frozen-lockfile`:

```sh
pnpm --filter @rr/qloo exec qloo --version
pnpm --filter @rr/qloo exec qloo api --help
pnpm typecheck
pnpm test
```

Version/help do not call Qloo. The app's readiness check also blocks network calls. Upstream 0.1.26's `--dry-run` still requires credential configuration, and its printed URL reads the saved config rather than the environment override. Do not use that preview as evidence of the app's endpoint or account access. Without an explicit `QLOO_API_KEY`, the project probe must remain `UNVERIFIED` with exit code 2 and make no provider call. Do not add a key to obtain an installation-status result.

## Documented request boundaries

The app uses GET `/search`, `/entities` and `/v2/insights`. Authentication is `X-Api-Key`, not Bearer auth or a URL parameter. Legacy `/recs` and `/recommendations` are excluded. Insights uses `filter.type=urn:entity:movie`, confirmed interest UUIDs, the same candidate UUID set for all cohorts, and a bounded `take`. See the detailed [request and evidence contract](QLOO_CONTRACT.md).

Search accepts `types` (plural), with its own enum. Do not copy the guide's Insights type list into Search. The [Search reference](https://docs.qloo.com/reference/get-search) uses `urn:entity:videogame`, whereas the guide's overview says `urn:entity:video_game`. The adapter uses the endpoint-specific spelling for gaming seeds and never guesses aliases after a failure. The [movie parameter table](https://docs.qloo.com/reference/available-parameters-by-entity-type#movie) confirms the fixed candidate filter and interest signals. Unsupported parameters can be ignored upstream, so local allowlists and complete-result checks are necessary even after HTTP 200.

## Quotas, privacy and acceptance

Neither source supplies a numeric event rate limit, total quota or key expiration. Obtain those from the organizers before live validation; do not invent a requests-per-second value. The guide directs rate-limit questions to `#api-help` in its linked Discord. The kit's [access rules](https://github.com/qloo/qloo-hackathon-kit/blob/main/docs/API_ACCESS.md) require organizers to publish quota, expiry and support details. Cache minimally, issue bounded requests, respect returned retry delays and stop when the local wait budget is exhausted.

Use public cultural signals and fictional aggregate cohorts. The [safe-use guidance](https://github.com/qloo/qloo-hackathon-kit/blob/main/docs/SAFE_USE.md) rules out individual identity/sensitive-trait inference and unnecessary personal-data uploads. Separate Qloo's data from the application's interpretation: rank percentiles are not attendance probabilities, and affinity never grants screening rights.

Before claiming a live demo, complete the [live checklist](live-validation-checklist.md) with confirmed mappings, a complete shared universe and actual response evidence. This project's 25-of-30 mapping threshold and ranking-difference heuristic are local acceptance checks, not official competition rules. The [kit submission guide](https://github.com/qloo/qloo-hackathon-kit/blob/main/docs/SUBMISSION.md) asks for reproducible setup, a redacted request-to-result explanation, a demo and limitations; verify the event's actual eligibility/deadline/rubric separately. Nothing here proves prize eligibility or submission completion.
