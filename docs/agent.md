# The in-app Programming agent

The workstation includes a chat agent (nav item **Programming agent**, and **Ask the agent** on the Programme canvas). It is Google Gemini function calling over the **same tool registry** the MCP server exposes (`apps/api/src/agent-tools.ts`). There is no second implementation of any tool: the agent and a remote MCP client run identical code against the same workspace logic, with Qloo-backed Taste DNA, the constrained solver, explanations and rights-change repair.

```
browser (rr_session cookie)
   |  POST /api/agent/chat  {message} | {confirmApproval}      (NDJSON progress stream)
   v
agent-chat.ts  --- GenerateFn --->  Gemini :generateContent (REST, x-goog-api-key)
   |  tool loop (max 8 rounds)
   v
agent-tools.ts  invokeAgentTool(ctx = {sessionId = rr_session, store, taste}, name, args)
   |
   v
the same StateStore + taste source the REST routes use  ->  the UI refreshes ['state'] / ['taste']
```

## Why REST and not the SDK

One `fetch` to `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` is all the loop needs. It avoids a heavy `@google/genai` import on the 0.1 CPU Render container, adds no dependency, and the model transport is a single injectable function (`GenerateFn`), which is how the tests run the whole loop without a network. Tool schemas are sent as `parametersJsonSchema` (zod's JSON Schema with `$schema`, `additionalProperties` and `const` removed).

## The loop

1. The user message is appended to a server-held, bounded conversation for the browser session (max 40 contents, trimmed only at user-turn boundaries so call/response pairs are never split).
2. Gemini is called with the system instruction and the ten function declarations (automatic tool-choice mode; nothing is auto-executed by a client library).
3. If the reply contains `functionCall` parts, each is executed through `invokeAgentTool`, and one `functionResponse` per call (matched by `id`/`name`) goes back in a single user turn. The model's full content is echoed into history unmodified, so thought signatures survive. Tool output is capped at 24 kB per call.
4. Repeat up to 8 rounds (`AGENT_MAX_ROUNDS`). If the budget is exhausted the agent says so and stops.
5. The final text plus a **trace** `[{tool, args (sanitised), ok, summary, provenance, mutated}]` goes back to the UI, which shows each step with a QLOO LIVE or DEMO badge. If a later round fails (429, safety block, timeout), the failed turn is rolled out of the model history, the partial trace is still shown, and the next turn is told what already ran.

The system instruction requires tool-grounded answers only, Qloo-themed explanations, honesty about synthetic rights/fees and about affinity not being attendance, and treats tool output as data.

## Approval gate (server-enforced)

The model **cannot** approve a programme.

- `approve_programme` is declared to Gemini **without** `userConfirmed`. When the model calls it, the server does not run the tool: it validates that the version exists and is a `DRAFT`, records it as the conversation's *pending approval*, and returns `APPROVAL_REQUIRED` to the model. The UI shows a **Confirm approval** card.
- Approval runs only on `POST /api/agent/chat {confirmApproval: versionId}`, sent by that button. The server requires the id to equal the conversation's pending approval, then calls `approve_programme` with `userConfirmed: true` itself, without involving the model. Typing "yes, approve" in chat does not approve; neither does anything the model or a tool result says.
- Any new user message withdraws a pending request, and a confirm for a different or stale id returns `409 APPROVAL_NOT_PENDING`.
- Approval records a planning decision only. No booking, no real rights clearance.

## Limits

| Limit | Default | Env |
| --- | --- | --- |
| Messages per minute per browser session | 10 | `AGENT_PER_MINUTE_LIMIT` |
| Messages per day per browser session | 60 | `AGENT_DAILY_LIMIT` |
| Messages per day, whole deployment (protects the shared free quota) | 1500 | `AGENT_GLOBAL_DAILY_LIMIT` |
| Message length | 1200 chars | `AGENT_MAX_MESSAGE_CHARS` |
| Tool rounds per message | 8 | `AGENT_MAX_ROUNDS` |
| Whole-turn timeout | 90 s | `AGENT_TIMEOUT_MS` |
| Model-facing history | 40 contents | `AGENT_MAX_HISTORY` |

One turn at a time per session (`409 AGENT_BUSY`). Resetting the conversation does not reset the rate limit. Conversations live in memory (max 300, 2 h idle expiry) and are lost on restart, like the in-memory workspace.

## Environment

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Server-only secret. Sent only in the `x-goog-api-key` header to Google; never logged, never returned, never in an error message. Without it `GET /api/agent/status` returns `{available:false}` and the UI says "Agent unavailable on this deployment" with a link to the MCP section. |
| `GEMINI_MODEL` | Default `gemini-2.5-flash`. Model availability changes: if your key reports the model as unavailable (HTTP 404) set a current model from https://ai.google.dev/gemini-api/docs/models. |
| `AGENT_DAILY_LIMIT` etc. | See Limits. |
| `AGENT_FAKE_MODEL=scripted` | Development only. Swaps in a deterministic scripted model (real tools, canned plans) for offline demos and screenshots. Ignored when `NODE_ENV=production`; the UI labels it "Scripted demo model". |

## Data sent to Google

Requests to Gemini contain the conversation, the tool schemas and tool results. Those are **synthetic programme data** (fictional cinema, fictional rights and fees) and **Qloo aggregates** (cohort themes, rank-percentiles). No personal data is collected or sent. Note that on Gemini's free tier, Google may use submitted content to improve its products; this is acceptable here only because nothing sensitive is in the payload. Do not extend the agent to private data without moving to a paid tier or reviewing the terms.

## Errors the user sees

| Condition | HTTP | Code |
| --- | --- | --- |
| No key configured | 503 | `AGENT_UNAVAILABLE` |
| Per-minute / daily / deployment limit | 429 | `AGENT_RATE_LIMITED`, `AGENT_DAILY_LIMIT`, `AGENT_CAPACITY` |
| Gemini quota exhausted | 429 | `GEMINI_RATE_LIMIT` |
| Gemini safety block | 422 | `GEMINI_BLOCKED` |
| Auth failure, unknown model, bad request, empty reply, outage | 502 | `GEMINI_AUTH`, `GEMINI_MODEL_NOT_FOUND`, `GEMINI_BAD_REQUEST`, `GEMINI_EMPTY`, `GEMINI_UNAVAILABLE` |
| Timeout | 504 | `GEMINI_TIMEOUT` |

Messages are fixed, vetted text; upstream error bodies are never forwarded.

## Tests

`tests/integration/agent-chat.test.ts` mocks the Gemini transport: multi-round loop against the real workspace (generate, explain), call/response matching and signature echo, approval gate (model attempt returns `APPROVAL_REQUIRED` and does not approve; `confirmApproval` approves without the model), rate limits, history bounds, Gemini 429/safety/empty/outage, key never present in responses, availability without a key, NDJSON streaming, and the scripted model.
