/**
 * Initializes the deterministic fixture through the real API in a fresh CLI
 * session. Intentionally does not receive, print or persist a browser cookie.
 */
const rawBase = process.env.RR_API_URL || 'http://localhost:3001';
let base: URL;
try {
  base = new URL(rawBase);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Expected an HTTP(S) URL without embedded credentials');
  }
} catch {
  console.error('RR_API_URL must be an HTTP(S) API origin without embedded credentials.');
  process.exit(1);
}

try {
  const response = await fetch(new URL('/api/demo/reset', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
  const state: unknown = await response.json();
  if (!state || typeof state !== 'object') throw new Error('API returned an invalid state');
  const data = state as Record<string, unknown>;
  const count = (key: string): number => Array.isArray(data[key]) ? data[key].length : -1;
  if (count('films') !== 30 || count('cohorts') !== 3 || count('slots') !== 4) {
    throw new Error('Unexpected fixture counts; expected 30 films, 3 cohorts and 4 slots');
  }
  console.log('Initialized an isolated CLI demo: 30 films, 3 fictional cohorts, 4 screening slots.');
  console.log('All rights, licence fees and affinities are synthetic. No browser session was changed.');
  console.log('To reset the open workstation, use its reset action.');
} catch (error) {
  console.error(`Demo initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  console.error('Start the API with pnpm dev, or set RR_API_URL to its origin, then retry.');
  process.exitCode = 1;
}

export {};
