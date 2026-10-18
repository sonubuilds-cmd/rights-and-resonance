# Rights & Resonance as an MCP server

Rights & Resonance is an **agentic tool**: any MCP client (Claude Code, Claude Desktop, other agents) can connect and use the same Qloo-backed workflow as the web UI. The agent reads live Qloo taste data, asks the constrained solver for a programme, explains every pick with shared Qloo themes, and handles a rights change with a minimal-change repair. A human still approves.

## Connect

| Client | How |
| --- | --- |
| Claude Code | `claude mcp add --transport http rights-resonance https://rights-and-resonance.onrender.com/mcp` |
| Claude Desktop | Settings, Connectors, Add custom connector, paste the `/mcp` URL |
| Other JSON-config clients | `{ "mcpServers": { "rights-resonance": { "type": "http", "url": "https://rights-and-resonance.onrender.com/mcp" } } }` |
| Local stdio (clone of the repo) | `{ "mcpServers": { "rights-resonance": { "command": "pnpm", "args": ["--silent", "--dir", "/path/to/rights-and-resonance", "mcp"], "env": { "QLOO_API_KEY": "optional" } } } }` |

Replace the host with your own deployment or `http://localhost:3001/mcp` when running `pnpm dev`. The web app's **Agent access** page shows the URL for the origin you are on, with copy buttons.

`pnpm --silent mcp` runs `apps/api/src/mcp-stdio.ts` with a private in-memory workspace. `--silent` matters: pnpm's own banner would otherwise corrupt the JSON-RPC stream on stdout. The stdio server logs only to stderr and reads `.env` if present. Without `QLOO_API_KEY` ask the agent to use DEMO mode.

Example prompt: *Plan a two-night season at the Lantern for our three audiences, explain each pick with Qloo themes, then tell me what happens if the rights to Her fall through.*

## Tools

| Tool | Input | Purpose |
| --- | --- | --- |
| `get_workspace` | none | Cinema, slots, budget, cohorts with cross-domain seeds, evidence mode, Qloo live status, existing versions |
| `get_taste_dna` | `cohortId?`, `filmId?` | Live Qloo cohort themes and per-film shared themes and why-lines, with provenance (`QLOO_LIVE` or `SYNTHETIC_DEMO`) and the workflow of calls |
| `search_films` | `query?`, `format?`, `eligibleOnly?`, `limit?` | Catalogue with **synthetic** rights/fees and slot eligibility |
| `generate_programme` | `mode?: QLOO \| DEMO` | Solver-built 4-film draft: slots, fees, cost vs budget, coverage, why-lines, version id |
| `explain_film` | `filmId` | Per-cohort rank and score, shared Qloo themes, seed-film handling, eligibility |
| `approve_programme` | `versionId`, `userConfirmed: true` | Records the human approval. The agent must have the user's explicit confirmation first |
| `withdraw_rights` | `filmId`, `reason?` | Synthetic rights change; invalidates affected approvals and returns the automatic repair draft and diff |
| `repair_programme` | `versionId?`, `policy?` | Repair draft with diff (swapped films, cost delta, coverage moves); returns the existing automatic repair when current |
| `compare_versions` | `fromVersionId`, `toVersionId` | Slot-by-slot diff, cost and coverage deltas |
| `export_programme` | `versionId?` | Approved schedule, evidence provenance and an unsent rights-enquiry draft |

Each result is `structuredContent` (JSON) plus a text block (a one-paragraph summary followed by the JSON), so clients that ignore structured output still work. Expected failures (unknown id, blocked Qloo generation, stale draft) come back as `isError` results with a code, not as crashes.

Prompts: `plan_season` (optional `focus`) and `handle_rights_change` (`film`).

## Guardrails

* The solver, not the model, selects films; the model cannot override rights, format, runtime or budget constraints.
* Approval is a separate tool that requires `userConfirmed: true`, and its description tells the agent to obtain explicit confirmation from the human first. Invalidated, superseded and stale drafts cannot be approved.
* Rights and fees are synthetic. Qloo affinity is cultural relevance, not an attendance forecast. Results state which evidence source (live Qloo or synthetic DEMO) was used; why-lines that quote Qloo ranks are only used when the programme was built from Qloo evidence.
* `QLOO_API_KEY` stays on the server and never appears in a tool result.

## Server behaviour (Streamable HTTP)

* Endpoint `/mcp` (POST, GET, DELETE) on the existing Fastify server and origin. JSON responses; the session id travels in `Mcp-Session-Id`.
* **Isolation:** every MCP session gets its own demo workspace in a dedicated in-memory store (never PostgreSQL, never the browser's cookie session). DELETE or expiry discards it.
* **Bounds:** at most `MCP_MAX_SESSIONS` (default 100) live sessions, least recently used evicted first; idle sessions expire after `MCP_SESSION_TTL_MINUTES` (default 60); at most 20 new sessions per minute per IP; `MCP_RATE_LIMIT_PER_MINUTE` (default 120) requests per IP; request bodies are limited to 64 KB. Unknown or expired sessions get HTTP 404 so clients re-initialize.
* **Origin handling:** MCP clients send no `Origin` header, so `/mcp` skips the cookie session and cross-site-mutation checks. If an `Origin` header **is** present it must be in `ALLOWED_ORIGINS`, otherwise the request is rejected with 403 (DNS-rebinding protection).
* There is no user authentication: like the rest of the demo, anyone who can reach the URL can create a workspace, and live Qloo calls spend the server's quota. Add access control before exposing a keyed deployment widely.

## For developers

* `apps/api/src/agent-tools.ts`: transport-agnostic registry. Exports `agentTools`, `getAgentTool`, `invokeAgentTool(ctx, name, input)` (validates input, never throws for expected failures), `toolInputJsonSchema(tool)` and `toolDeclarations()` (`{ name, description, parameters }` for LLM function calling), plus `AgentToolContext { sessionId, store, taste }`.
* `apps/api/src/operations.ts`: state transitions shared by REST routes and tools (`applyChange`, `approveVersion`, `revokeRights`).
* `apps/api/src/mcp-server.ts`: `createAgentMcpServer(ctx)` wires the registry and prompts into `@modelcontextprotocol/sdk`.
* `apps/api/src/mcp-http.ts`: `/mcp` routes and the bounded session manager. `apps/api/src/mcp-stdio.ts`: stdio entry.
* Tests: `tests/integration/mcp.test.ts` (in-memory and real HTTP clients, hermetic DEMO mode).
