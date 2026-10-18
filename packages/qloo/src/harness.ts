import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QLOO_HARNESS_PACKAGE = '@qloo/qloo-harness';
export const QLOO_HARNESS_MINIMUM_VERSION = '0.1.26';
export type HarnessInput = { action: 'capabilities' } | { action: 'request'; url: string };
export type HarnessOutput = { ok: true; version: string; capabilities?: string[]; networkCalls?: number; command?: string; cliExitCode?: number; httpStatus?: number; retryAfter?: string | null; text?: string } | { ok: false; code: 'MISSING' | 'INCOMPATIBLE' | 'CONTRACT' | 'NETWORK' | 'OUTPUT_LIMIT' | 'TIMEOUT' | 'CONFIGURATION'; version?: string };
export type HarnessRunner = (input: HarnessInput, options: { apiKey?: string; timeoutMs: number }) => Promise<HarnessOutput>;
/** Absolute local worker + execFile: no shell, arbitrary binary, user-supplied argv, or global credential fallback. */
/** Network-only passthrough so the worker can reach the provider behind a corporate/egress proxy. No credentials beyond proxy URLs. */
const NETWORK_ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'] as const;
const networkEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const name of NETWORK_ENV) { const value = process.env[name]; if (value) env[name] = value; }
  if (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy) env.NODE_USE_ENV_PROXY = '1';
  return env;
};
export const runHarness: HarnessRunner = async (input, options) => {
  const home = await mkdtemp(join(tmpdir(), 'rr-qloo-'));
  try {
    return await new Promise<HarnessOutput>(resolve => {
      const child = execFile(process.execPath, [fileURLToPath(new URL('./harness-worker.mjs', import.meta.url))], {
        timeout: options.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4_100_000, encoding: 'utf8',
        env: { ...networkEnv(), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}), TEMP: home, TMP: home, HOME: home, QLOO_HOME: join(home, 'qloo'), QLOO_BASE_URL: 'https://hackathon.api.qloo.com', QLOO_TRUSTED_BASE_URL: 'https://hackathon.api.qloo.com', ...(options.apiKey ? { QLOO_API_KEY: options.apiKey } : {}), NO_COLOR: '1', PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1' },
      }, (error, stdout) => {
        if (error) { resolve({ ok: false, code: error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'OUTPUT_LIMIT' : error.killed ? 'TIMEOUT' : 'CONTRACT' }); return; }
        try {
          const result: unknown = JSON.parse(stdout);
          if (!result || typeof result !== 'object' || !('ok' in result) || typeof result.ok !== 'boolean' || (result.ok && (!('version' in result) || typeof result.version !== 'string')) || (!result.ok && (!('code' in result) || typeof result.code !== 'string'))) throw new Error('Invalid worker output');
          resolve(result as HarnessOutput);
        } catch { resolve({ ok: false, code: 'CONTRACT' }); }
      });
      child.stdin?.on('error', () => {});
      child.stdin?.end(JSON.stringify(input));
    });
  } finally { await rm(home, { recursive: true, force: true }); }
};
