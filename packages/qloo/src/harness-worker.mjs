/** Private bounded process entry point; no credentials are accepted in argv or request JSON. */
import { executeHarness } from './harness-runtime.mjs';
let text = '';
try {
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 32_000) throw new Error('Input limit');
  }
  const result = await executeHarness(JSON.parse(text));
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
} catch {
  process.stdout.write(JSON.stringify({ ok: false, code: 'CONTRACT' }), () => process.exit(1));
}
