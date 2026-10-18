/**
 * Stdio MCP entry for local clients (Claude Desktop, Claude Code):  pnpm --silent mcp
 * One private in-memory workspace per process. stdout carries ONLY JSON-RPC; all logging goes to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MemoryStore } from './store.js';
import { createInitialState } from './state.js';
import { createTasteSource } from './taste.js';
import { createAgentMcpServer } from './mcp-server.js';

const store = new MemoryStore(() => createInitialState('memory'));
const server = createAgentMcpServer({ sessionId: 'stdio', store, taste: createTasteSource() });
await server.connect(new StdioServerTransport());
const live = Boolean(process.env.QLOO_API_KEY?.trim());
console.error(`rights-and-resonance MCP (stdio) ready. Qloo ${live ? 'configured: QLOO mode available' : 'not configured: use DEMO mode'}.`);
const stop = () => { void server.close().finally(() => process.exit(0)); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
