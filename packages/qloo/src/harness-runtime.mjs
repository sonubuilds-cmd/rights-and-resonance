/** Runs the public, pinned harness, never an imitation. Only called in an isolated child in production.
 * 0.1.26 `qloo api --json` formats entity arrays and loses the original envelope and HTTP headers.
 * Observe its real fetch boundary so provenance and Retry-After survive that formatting.
 */
const MAX_BYTES = 4_000_000;
const EXPECTED_ORIGIN = 'https://hackathon.api.qloo.com';
export const HARNESS_MINIMUM_VERSION = '0.1.26';
const canonical = value => { const url = new URL(value); url.searchParams.sort(); return url.toString(); };
const supportedVersion = value => /^\d+\.\d+\.\d+$/.test(value) && value.split('.').reduce((v, n) => v * 100000 + Number(n), 0) >= 100026;
const safeResult = code => ({ ok: false, code });

export function harnessArguments(endpoint, params) {
  if (endpoint === '/search') return ['api', 'search', '--query', params.query, '--take', params.take, '--params', JSON.stringify(params), '--json'];
  if (endpoint === '/entities') return ['api', 'entity', '--id', params.entity_ids, '--json'];
  if (endpoint === '/v2/insights') {
    // Movie candidate insights, or tag insights (filter.type=urn:tag). Anything else is refused, never passed through.
    const type = params['filter.type'];
    if (type !== 'urn:entity:movie' && type !== 'urn:tag') throw new Error('Unsupported insights type');
    return ['api', 'insights', '--type', type, '--take', params.take, '--params', JSON.stringify(params), '--json'];
  }
  throw new Error('Unsupported endpoint');
}

/** fetchImpl injection is for synthetic contract tests; the child protocol never accepts one. */
export async function executeHarness(input, fetchImpl = globalThis.fetch) {
  const originalFetch = globalThis.fetch;
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  let output = '', outputBytes = 0, calls = 0, observation, failure;
  const capture = chunk => { const text = String(chunk); outputBytes += Buffer.byteLength(text); if (outputBytes > MAX_BYTES) { failure = 'OUTPUT_LIMIT'; throw new Error('Output limit'); } output += text; return true; };
  process.stdout.write = capture;
  process.stderr.write = chunk => { outputBytes += Buffer.byteLength(String(chunk)); if (outputBytes > MAX_BYTES) { failure = 'OUTPUT_LIMIT'; throw new Error('Output limit'); } return true; };
  // Also blocks accidental network work during module initialization and local capability checks.
  globalThis.fetch = async (resource, init) => {
    if (input.action !== 'request' || ++calls !== 1) { failure = 'CONTRACT'; throw new Error('Unexpected network request'); }
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    const expected = new URL(input.url);
    const headers = new Headers(init?.headers);
    if (url.origin !== EXPECTED_ORIGIN || expected.origin !== EXPECTED_ORIGIN || canonical(url) !== canonical(expected) || init?.method !== 'GET' || init?.body !== undefined || headers.get('X-Api-Key') !== process.env.QLOO_API_KEY || headers.has('authorization')) {
      failure = 'CONTRACT'; throw new Error('Harness request differs from approved request');
    }
    let response;
    try { response = await fetchImpl(resource, { ...init, redirect: 'error' }); }
    catch { failure = 'NETWORK'; throw new Error('Network request failed'); }
    if (response.redirected) { failure = 'CONTRACT'; throw new Error('Redirect refused'); }
    if (!response.ok) {
      observation = { httpStatus: response.status, retryAfter: response.headers.get('retry-after'), text: '' };
      await response.body?.cancel();
      return new Response('{}', { status: response.status, headers: { 'content-type': 'application/json' } });
    }
    const reader = response.body?.getReader();
    const chunks = []; let bytes = 0;
    if (reader) while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); failure = 'OUTPUT_LIMIT'; throw new Error('Response limit'); }
      chunks.push(chunk.value);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    // A provider error or echo must not leak the configured credential into stored raw evidence.
    if (process.env.QLOO_API_KEY && text.includes(process.env.QLOO_API_KEY)) { failure = 'CONTRACT'; throw new Error('Credential echoed in response'); }
    observation = { httpStatus: response.status, retryAfter: response.headers.get('retry-after'), text: response.ok ? text : '' };
    // Error bodies are untrusted and are deliberately never forwarded to the CLI or parent.
    return new Response(response.ok ? text : '{}', { status: response.status, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { runQloo, HARNESS_VERSION } = await import('@qloo/qloo-harness');
    if (!supportedVersion(HARNESS_VERSION)) return { ...safeResult('INCOMPATIBLE'), version: HARNESS_VERSION };
    if (input.action === 'capabilities') {
      const versionCode = await runQloo(['--version']);
      if (versionCode !== 0 || output.trim() !== HARNESS_VERSION) return safeResult('CONTRACT');
      output = '';
      const capabilities = [];
      for (const [command, requiredFlags] of [['search', ['--query', '--params', '--json']], ['entity', ['--id', '--json']], ['insights', ['--type', '--params', '--json']]]) {
        output = '';
        const exitCode = await runQloo(['api', command, '--help']);
        if (exitCode !== 0 || requiredFlags.some(flag => !output.includes(flag))) return safeResult('CONTRACT');
        capabilities.push(`api ${command}`);
      }
      return { ok: true, version: HARNESS_VERSION, capabilities, networkCalls: calls };
    }
    if (input.action !== 'request' || !process.env.QLOO_API_KEY) return safeResult('CONFIGURATION');
    const url = new URL(input.url);
    const params = Object.fromEntries(url.searchParams);
    const args = harnessArguments(url.pathname, params);
    const cliExitCode = await runQloo(args);
    if (failure) return safeResult(failure);
    if (!observation || calls !== 1) return safeResult('CONTRACT');
    if (observation.httpStatus >= 200 && observation.httpStatus < 300 && cliExitCode !== 0) return safeResult('CONTRACT');
    return { ok: true, version: HARNESS_VERSION, command: args[1], cliExitCode, ...observation };
  } catch (error) {
    return safeResult(failure ?? (error?.code === 'ERR_MODULE_NOT_FOUND' ? 'MISSING' : 'CONTRACT'));
  } finally {
    globalThis.fetch = originalFetch; process.stdout.write = originalOut; process.stderr.write = originalErr;
  }
}
