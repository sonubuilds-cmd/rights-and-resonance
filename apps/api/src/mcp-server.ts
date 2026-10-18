/**
 * MCP server factory: exposes the transport-agnostic tool registry (agent-tools.ts) plus two prompts.
 * Used by the Streamable HTTP route (mcp-http.ts) and by the stdio entry (mcp-stdio.ts).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { agentTools, invokeAgentTool, type AgentToolContext, type AgentToolOutcome } from './agent-tools.js';

export const MCP_SERVER_NAME = 'rights-and-resonance';
export const MCP_SERVER_VERSION = '0.2.1';
export const MCP_INSTRUCTIONS = [
  'Rights & Resonance helps an independent cinema (The Lantern) programme a two-night, four-slot season for three audience cohorts using Qloo cross-domain taste data and a deterministic constraint solver.',
  'Typical flow: get_workspace -> get_taste_dna -> generate_programme -> explain_film for each pick -> (user confirms) approve_programme -> withdraw_rights / repair_programme / compare_versions -> export_programme.',
  'Rules: the solver chooses films, not you. Never call approve_programme unless the human explicitly asked to approve. Rights and fees are synthetic. Qloo scores are cultural-affinity ranks, not attendance forecasts. Say which evidence source (Qloo live vs synthetic DEMO) was used.',
].join('\n');

/** Shape an outcome as an MCP tool result: concise text for any client, structuredContent for capable ones. */
export function toCallToolResult(outcome: AgentToolOutcome): CallToolResult {
  if (!outcome.ok) {
    return { isError: true, content: [{ type: 'text', text: `${outcome.error.code}: ${outcome.error.message}` }], structuredContent: { error: outcome.error } };
  }
  const structured = outcome.data !== null && typeof outcome.data === 'object' && !Array.isArray(outcome.data) ? outcome.data as Record<string, unknown> : { result: outcome.data };
  return { content: [{ type: 'text', text: `${outcome.summary}\n\n${JSON.stringify(outcome.data)}` }], structuredContent: structured };
}

export function createAgentMcpServer(ctx: AgentToolContext): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: 'Rights & Resonance' }, { instructions: MCP_INSTRUCTIONS });
  for (const tool of agentTools) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.inputSchema as z.ZodObject, annotations: tool.annotations },
      (async (args: unknown) => toCallToolResult(await invokeAgentTool(ctx, tool.name, args))) as never);
  }
  server.registerPrompt('plan_season', {
    title: 'Plan a season',
    description: 'Plan a two-night season at The Lantern for the three audience cohorts, explaining each pick with Qloo themes.',
    argsSchema: { focus: z.string().max(300).optional().describe('Optional curatorial emphasis, e.g. "lean into literary adaptations"') },
  }, ({ focus }) => ({
    messages: [{ role: 'user', content: { type: 'text', text:
`Plan a two-night season at The Lantern for our three audiences.${focus ? ` Curatorial emphasis: ${focus}.` : ''}
1. Call get_workspace, then get_taste_dna to learn the cohorts and their Qloo cultural themes.
2. Call generate_programme (use QLOO if Qloo is configured, otherwise DEMO and say so).
3. For each of the four films call explain_film and explain the pick using the shared Qloo themes and each cohort's rank. Be honest about seed films and about any synthetic evidence.
4. Summarise cost against budget and cohort coverage, then ask me whether to approve. Do NOT call approve_programme until I explicitly say so.` } }],
  }));
  server.registerPrompt('handle_rights_change', {
    title: 'Handle a rights change',
    description: 'Walk through what happens when rights to a film in the programme fall through, and propose a repair.',
    argsSchema: { film: z.string().min(1).max(200).describe('Title or id of the film whose rights fall through') },
  }, ({ film }) => ({
    messages: [{ role: 'user', content: { type: 'text', text:
`The rights to "${film}" have fallen through. Find it with search_films if needed, then:
1. If there is an approved programme, call withdraw_rights for that film (this is a synthetic what-if; tell me it is simulated). If nothing is approved yet, explain that and stop.
2. Present the repair draft: which films were swapped, the cost change, and how each cohort's coverage moved (use compare_versions if helpful). Use explain_film on the replacement and describe its Qloo themes.
3. Ask me whether to approve the repair. Do NOT call approve_programme until I explicitly say so.` } }],
  }));
  return server;
}
