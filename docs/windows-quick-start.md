# Windows quick start and private live check

Requires Node.js 22.19.0 or newer and pnpm 10.18.3. Extract the source ZIP, then open PowerShell in the folder containing `package.json`. No deployment is needed.

## Run the synthetic demo

```powershell
corepack enable
corepack prepare pnpm@10.18.3 --activate
pnpm install --frozen-lockfile
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm dev
```

Open http://localhost:5173. Keep using the same hostname so cookies remain consistent. Leave `QLOO_API_KEY` empty for this demo. All included rights, fees and affinity data are synthetic. Stop with Ctrl+C. Do not replace an existing `.env` blindly; it may contain your configuration. If you copied an older template, remove `NODE_ENV=development` from it before a production build, since Vite can otherwise bundle development React.

Local checks:

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm test:http
```

`test:http` starts its own isolated memory API, makes real local HTTP requests through generation, approval, withdrawal, repair and export, and then closes it. It deliberately suppresses provider keys and makes no Qloo or LLM requests. Browser tests remain separate: `pnpm test:e2e` requires a working Playwright browser runtime.

## Configure the key privately for this terminal only

Use your own valid hackathon key. This prompt masks typing and keeps the value out of PowerShell command history. Never paste the key into chat, a command literal, source code or a `VITE_` variable.

```powershell
$env:QLOO_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'Qloo API key' -AsSecureString)).Password
$env:QLOO_BASE_URL = 'https://hackathon.api.qloo.com'
$env:QLOO_TRANSPORT = 'harness'
pnpm probe
```

The real key is intentionally not included in this archive or its `.env.example`. Existing environment variables take precedence over `.env` when the probe starts. `pnpm probe` makes live calls and consumes your account's quota; check your current event access/limits first. A healthy full run considers 30 films, 9 seeds and 3 profiles, with cache reuse and bounded retries. Authentication, quota or availability failures stop it early rather than repeatedly querying the catalogue.

- Exit 0: all automated technical feasibility gates passed
- Exit 2: gates failed, the probe stopped early, or no key was configured; inspect status and failure codes
- Exit 1: local configuration or script failure

Share only `reports/qloo-probe-summary.json` for troubleshooting. Keep `reports/qloo-probe.json` local: it deliberately retains full provider evidence. The summary omits raw provider content, request URLs, headers, entity IDs and provider messages. Unfinished gates are `null`, not measured failures.

A probe pass does not set up the browser's mappings. To test the application live, start `pnpm dev` from the same configured terminal, confirm at least 25 film mappings and every cohort's seed mappings in the interface, choose QLOO mode, generate a draft, inspect evidence, then explicitly approve and test repair. Rights and fees remain synthetic even with live affinity scores. Restart the API after changing configuration.

When finished, stop the API with Ctrl+C and remove the session key:

```powershell
Remove-Item Env:\QLOO_API_KEY -ErrorAction SilentlyContinue
```

Closing that terminal also removes its session environment. Do not share `.env`, terminal environment dumps, session cookies or raw evidence reports. This workflow does not establish real screening rights or an attendance forecast.
