/**
 * Streamable HTTP MCP endpoint (POST/GET/DELETE /mcp) on the existing Fastify server.
 * Each MCP session (Mcp-Session-Id) owns an isolated demo workspace in a dedicated in-memory store.
 * Sessions are bounded in number (LRU eviction) and expire when idle.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryStore } from './store.js';
import { createInitialState } from './state.js';
import type { TasteDnaSource } from './taste.js';
import { createAgentMcpServer } from './mcp-server.js';

export const MCP_PATH = '/mcp';
export const isMcpPath = (url: string) => (url.split('?')[0] ?? '') === MCP_PATH;
export const MCP_BODY_LIMIT = 64 * 1024;

interface McpSession { id: string; transport: StreamableHTTPServerTransport; server: McpServer; lastUsed: number }
export interface McpSessionOptions { maxSessions?: number; idleTtlMs?: number; maxInitPerMinute?: number; now?: () => number }

const rpcError = (code: number, message: string) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

export class McpSessionManager {
  readonly store: MemoryStore;
  private sessions = new Map<string, McpSession>();
  private inits = new Map<string, number[]>();
  private timer?: NodeJS.Timeout;
  readonly maxSessions: number; readonly idleTtlMs: number; private maxInit: number; private clock: () => number;
  constructor(private taste: TasteDnaSource, options: McpSessionOptions = {}) {
    this.maxSessions = options.maxSessions ?? Number(process.env.MCP_MAX_SESSIONS ?? 100);
    this.idleTtlMs = options.idleTtlMs ?? Number(process.env.MCP_SESSION_TTL_MINUTES ?? 60) * 60_000;
    this.maxInit = options.maxInitPerMinute ?? 20; this.clock = options.now ?? Date.now;
    this.store = new MemoryStore(() => createInitialState('memory'));
    this.timer = setInterval(() => void this.sweep(), 60_000); this.timer.unref();
  }
  get size() { return this.sessions.size; }
  private async drop(session: McpSession) {
    this.sessions.delete(session.id); this.store.discard(`mcp:${session.id}`);
    try { await session.transport.close(); } catch { /* already closed */ }
  }
  async sweep() { for (const s of [...this.sessions.values()]) if (this.clock() - s.lastUsed > this.idleTtlMs) await this.drop(s); }
  private initAllowed(ip: string) {
    const t = this.clock(); const recent = (this.inits.get(ip) ?? []).filter(x => t - x < 60_000);
    if (recent.length >= this.maxInit) { this.inits.set(ip, recent); return false; }
    recent.push(t); this.inits.set(ip, recent);
    if (this.inits.size > 5000) this.inits.clear();
    return true;
  }
  private async create(): Promise<McpSession> {
    await this.sweep();
    while (this.sessions.size >= this.maxSessions) { // bounded: evict the least recently used workspace
      const lru = [...this.sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0]!; await this.drop(lru);
    }
    const id = randomUUID();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => id, enableJsonResponse: true });
    const server = createAgentMcpServer({ sessionId: `mcp:${id}`, store: this.store, taste: this.taste });
    const session: McpSession = { id, transport, server, lastUsed: this.clock() };
    transport.onclose = () => { if (this.sessions.delete(id)) this.store.discard(`mcp:${id}`); };
    await server.connect(transport);
    this.sessions.set(id, session);
    return session;
  }
  async handle(req: FastifyRequest, reply: FastifyReply) {
    const send = (status: number, body: unknown) => reply.status(status).header('Cache-Control', 'no-store').send(body);
    const header = req.headers['mcp-session-id'];
    const sid = Array.isArray(header) ? header[0] : header;
    let session: McpSession | undefined;
    if (sid) {
      session = this.sessions.get(sid);
      if (!session) return send(404, rpcError(-32001, 'Unknown or expired MCP session. Re-initialize to get a new isolated demo workspace.'));
      if (this.clock() - session.lastUsed > this.idleTtlMs) { await this.drop(session); return send(404, rpcError(-32001, 'MCP session expired. Re-initialize.')); }
    } else if (req.method === 'POST' && isInitializeRequest(req.body)) {
      if (!this.initAllowed(req.ip)) return send(429, rpcError(-32029, 'Too many new MCP sessions from this address. Try again in a minute.'));
      session = await this.create();
    } else {
      return send(400, rpcError(-32000, req.method === 'POST' ? 'Missing Mcp-Session-Id header: send an initialize request first.' : 'Missing Mcp-Session-Id header.'));
    }
    session.lastUsed = this.clock();
    reply.hijack();
    // Carry over headers other plugins set on the reply (e.g. CORS for an allowed browser Origin).
    for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) reply.raw.setHeader(k, v);
    try { await session.transport.handleRequest(req.raw, reply.raw, req.body); }
    catch {
      if (!reply.raw.headersSent) { reply.raw.statusCode = 500; reply.raw.setHeader('Content-Type', 'application/json'); reply.raw.end(JSON.stringify(rpcError(-32603, 'Internal error'))); }
      else reply.raw.end();
    }
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    for (const s of [...this.sessions.values()]) await this.drop(s);
  }
}

/** Register /mcp. Origin policy (DNS-rebinding protection) is enforced by the server's global onRequest hook. */
export function registerMcpRoutes(app: FastifyInstance, taste: TasteDnaSource, options: McpSessionOptions = {}) {
  const manager = new McpSessionManager(taste, options);
  app.addHook('onClose', async () => manager.close());
  const config = { rateLimit: { max: Number(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? 120), timeWindow: '1 minute' } };
  const handler = (req: FastifyRequest, reply: FastifyReply) => manager.handle(req, reply);
  app.post(MCP_PATH, { bodyLimit: MCP_BODY_LIMIT, config }, handler);
  app.get(MCP_PATH, { config }, handler);
  app.delete(MCP_PATH, { config }, handler);
  return manager;
}
