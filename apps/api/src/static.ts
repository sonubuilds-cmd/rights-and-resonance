import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

/** Resolve the built web bundle, or null when it should not be served. */
export function resolveWebRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.SERVE_WEB === 'false') return null;
  const root = resolve(env.WEB_DIST_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url)));
  if (!existsSync(join(root, 'index.html'))) {
    if (env.SERVE_WEB === 'true') throw new Error(`SERVE_WEB=true but ${join(root, 'index.html')} does not exist; run pnpm build first.`);
    return null;
  }
  return root;
}

/** True for requests the static handler owns (everything except the API and health check). */
export function isWebPath(url: string): boolean {
  const path = url.split('?')[0] ?? '/';
  return !(path === '/api' || path.startsWith('/api/') || path === '/healthz');
}

function safeFile(root: string, urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const full = resolve(root, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded));
  if (full !== root && !full.startsWith(root + sep)) return null;
  try { return statSync(full).isFile() ? full : null; } catch { return null; }
}

/** Minimal static host with SPA fallback. GET/HEAD only; path traversal is rejected. */
export function registerWebHost(app: FastifyInstance, root: string) {
  const index = join(root, 'index.html');
  app.setNotFoundHandler((req, reply) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !isWebPath(req.url)) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Route not found' });
    }
    const urlPath = req.url.split('?')[0] ?? '/';
    const file = safeFile(root, urlPath);
    // Unknown file-like paths (e.g. /assets/missing.js) must 404, not return HTML.
    if (!file && extname(urlPath)) return reply.status(404).type('text/plain; charset=utf-8').send('Not found');
    const target = file ?? index;
    const hashed = /^\/assets\/.+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/.test(urlPath);
    reply.header('Cache-Control', file && hashed ? 'public, max-age=31536000, immutable' : target === index ? 'no-cache' : 'public, max-age=3600');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.type(TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream');
    return reply.send(req.method === 'HEAD' ? '' : createReadStream(target));
  });
}
