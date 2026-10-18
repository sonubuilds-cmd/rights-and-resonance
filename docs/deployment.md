# Deployment setup

These are optional setup instructions, not a deployment record. No account, repository, hosting service, database or paid subscription is created by unpacking this project. Check the provider's current terms, availability and price before provisioning. Live Qloo behavior remains unverified until the feasibility probe succeeds with the intended account.

## Deploy to Render in 5 steps (single service, recommended)

The API container also serves the built web bundle, so the browser talks to one origin: no CORS, no third-party cookies, `SameSite=Lax` works.

1. Push the repository to GitHub (or GitLab).
2. In Render choose **New → Blueprint**, select the repository; it reads `render.yaml` (one Docker web service, free plan, health check `/healthz`).
3. When prompted, set the secret **`QLOO_API_KEY`** (optional; without it the live Qloo gate stays UNVERIFIED and Demo mode still works). Leave `ALLOWED_ORIGINS` blank for now.
4. After the first deploy, copy the service URL (for example `https://rights-and-resonance.onrender.com`), set **`ALLOWED_ORIGINS`** to exactly that URL (no path, no trailing slash) and redeploy.
5. Open the URL: generate, approve, withdraw rights, approve the repair. Then tick the [hosted acceptance checklist](#9-hosted-acceptance-checklist).

Notes: `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=lax` are preset. Web serving is automatic when `apps/web/dist` exists (the Docker image builds it); `SERVE_WEB=true` makes a missing bundle a startup error, `SERVE_WEB=false` turns it off. Static files get long-cache headers when hashed and `no-cache` for `index.html`; unknown non-`/api` paths fall back to the SPA. Free instances spin down when idle (first request is slow) and keep state in memory only, so state resets on restart; add `DATABASE_URL` for persistence. This path has been verified locally with `pnpm build` and `SERVE_WEB=true`, not on a live Render account; record your own result. If you run the harness behind an egress proxy that re-signs TLS (not the case on Render), it needs `NODE_EXTRA_CA_CERTS` pointing to the proxy CA bundle.

## 1. Local baseline

Use Node 22.19.0+ and pnpm 10.18.3 from the repository root:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

The browser runs at `http://localhost:5173`; the API listens on port 3001. Vite proxies `/api`, giving the browser a same-origin local workflow. `pnpm start` runs only the API. `pnpm build` creates `apps/web/dist`; it does not start a static host.

Before hosting, run `pnpm test`, `pnpm typecheck` and `pnpm build`. Run the browser suite separately using its Playwright setup. Record anything blocked; a successful bundle does not verify an actual deployed browser session.

## 2. Environment contract

| Variable | Where | Purpose |
| --- | --- | --- |
| `HOST` | API | Bind address, normally `0.0.0.0` in containers |
| `PORT` | API | HTTP port; local default 3001; honor the hosting platform's injected value |
| `NODE_ENV` | API | Set `production` on a hosted service |
| `ALLOWED_ORIGINS` | API | Comma-separated exact browser origins, including scheme and port where applicable, with no path or trailing slash |
| `COOKIE_SECURE` | API | `true` on HTTPS deployments; `false` only for local HTTP |
| `COOKIE_SAME_SITE` | API | `lax` for local/same-site/single-origin; `none` only for genuinely cross-site requests, with Secure enabled |
| `SERVE_WEB` | API | Unset: serve `apps/web/dist` if it exists. `true`: require it. `false`: API only |
| `WEB_DIST_DIR` | API | Optional override of the bundle directory |
| `DATABASE_URL` | API | Optional PostgreSQL connection string; absent means ephemeral in-memory state |
| `QLOO_API_KEY` | API/probe only | Explicit event key, held as a private environment secret; separate harness configuration is not adopted |
| `QLOO_TRANSPORT` | API/probe | `harness` by default; `direct-http` only when explicitly selected, never a fallback |
| `QLOO_BASE_URL` | API/probe | Event endpoint, restricted to `https://hackathon.api.qloo.com`; set explicitly for standalone harness commands too |
| `QLOO_CACHE_TTL_MS` | API/probe | Optional cache TTL; sample configuration 900000 ms |
| `QLOO_TIMEOUT_MS` | API/probe | Optional per-attempt timeout; sample configuration 10000 ms |
| `QLOO_RETRY_BUDGET_MS` | API/probe | Total retry-wait budget, default 5000 ms, range 0–30000; never shortens provider `Retry-After` |
| `LLM_API_KEY` | API only | Optional model-service key for LLM-only comparison |
| `LLM_MODEL` | API only | Optional intended model identifier; use a model available to your account |
| `LLM_BASE_URL` | API only | Optional compatible model API base URL; use only a trusted endpoint |
| `VITE_API_BASE_URL` | Web build | Public API origin, e.g. `https://api.example.com`; leave empty for same-origin proxy use |
| `RR_API_URL` | seed script | Optional API origin for `pnpm seed`, default `http://localhost:3001` |

The web fetch layer appends `/api/...` itself. Do not include `/api` in `VITE_API_BASE_URL`. Build-time Vite values become public JavaScript; provider/database credentials must never be prefixed `VITE_`, copied into `apps/web`, or passed as public build variables. Rebuild the web bundle after changing its API origin. Restart the API after changing server variables.

The [hackathon alignment guide](hackathon-alignment.md) explains key acquisition, the upstream production-default hazard, offline harness checks and the live gate. Do not use `qloo setup` during image builds or include a personal harness config in the image.

## 3. Sessions, origins and cookies

An HTTP-only random `rr_session` cookie selects an isolated workspace. It lasts seven days; this is an anonymous prototype session, not a user account or proof of approver identity. Never put a session cookie in a URL or screenshot. New visitors are initialized with a fresh synthetic fixture.

For a Pages frontend and an API on unrelated default provider domains:

```dotenv
# API runtime:
ALLOWED_ORIGINS=https://your-project.pages.dev
COOKIE_SECURE=true
COOKIE_SAME_SITE=none

# Web build:
VITE_API_BASE_URL=https://your-api.example-host.com
```

Both sides use HTTPS. Browser requests include credentials; the API must return the specific allowed origin with credentials enabled. A wildcard CORS origin is incompatible with this cookie workflow. Preview deployment hostnames require deliberate entries; do not allow arbitrary `*.pages.dev` sites. The API rejects an explicitly unapproved Origin. CLI requests with no Origin are supported; the session cookie is a bearer capability, so keep it private.

**CORS and SameSite are different controls.** `SameSite=None; Secure` permits cross-site cookies but does not defeat browser third-party-cookie blocking. If each request appears to create a new workspace, inspect browser cookie warnings and `Set-Cookie`/Cookie headers before debugging the solver. Do not work around this by exposing credentials or relaxing origins to `*`.

Prefer a same-site deployment such as `programme.example.com` and `api.example.com` over HTTPS, or a same-origin reverse proxy that forwards `/api` to the API. Two subdomains still require the exact CORS origin and credentialed fetch, but they can use `SameSite=Lax` when they are genuinely same-site. A proxy must forward method, request body and cookies, preserve `Set-Cookie`, and keep health routing separate. This project does not include a Cloudflare Worker/reverse-proxy implementation.

The local Vite development proxy is not a production proxy. Do not assume deploying static files reproduces that behavior.

## 4. Optional PostgreSQL / Neon

Without `DATABASE_URL`, every restart loses state; multiple API instances have separate state. That mode is useful only for temporary demos. To preserve history, provision a PostgreSQL database yourself and set the API's private `DATABASE_URL`.

The API runs `apps/api/db/migrations/001_initial.sql` during startup when PostgreSQL is configured. Review that file before connecting an existing database. Use a dedicated database, maintain backups, and give the runtime identity only the privileges it requires; automatic schema initialization needs the corresponding DDL permissions. The implementation stores a canonical session snapshot with relational records in a transaction. It is not a substitute for a database backup, access policy or immutable external archive.

For Neon, obtain the connection string in the project's connection dialog and retain the provider's TLS settings. Follow the official [Neon connection guide](https://neon.com/docs/connect/connect-from-any-app). Keep the URL in API service secrets. Never paste a real connection string into a frontend variable or commit it. Start with one API instance; validate concurrent-write behavior before horizontal scaling.

After configuration:

1. Start the API and check `/healthz` and startup logs for migration/connection errors.
2. Open one browser, generate and approve a demo version, then note its version ID.
3. Restart the API and refresh in the same browser. Check that the same version and evidence are still present and the provider status reports PostgreSQL.
4. Verify that a separate browser session has a separate workspace.
5. Test database restore independently before relying on the history for real work.

The startup migration is not a release-migration framework. Future schema changes should get separately reviewed, ordered migrations and rollback/recovery plans. Do not claim database deployment was tested unless the exact database-backed restart scenario was actually run.

## 5. Docker image (API + web)

From the project root:

```sh
docker build -t rights-and-resonance .
docker run --rm -p 3001:3001 --env-file .env rights-and-resonance
```

The image builds the web bundle and serves it with the API from one origin (open `http://localhost:3001`; add that origin to `ALLOWED_ORIGINS`). It runs as a non-root user, includes the pinned Qloo harness through workspace dependencies, and probes `/healthz`. The Qloo child process runs in the same server environment; it is not deployed in the static frontend. Missing private Qloo credentials keep live evidence unavailable. It intentionally includes TypeScript source and `tsx` because workspace package exports point to source. Development dependencies have not been aggressively pruned; review image size, dependency vulnerabilities and runtime policy before production use.
`.dockerignore` excludes `.env`, provider reports, local dependency folders and browser test output. Service secrets should be injected at runtime, not passed through Docker build arguments. If a local database runs on your host, a container's `localhost` points to the container, not the host; configure an appropriate database hostname for your platform.

## 6. Cloudflare Pages frontend

Deploy only the static frontend to Pages:

- Repository/project root: the directory containing this `package.json` and `pnpm-workspace.yaml`
- Build command: `pnpm install --frozen-lockfile && pnpm build`
- Output directory: `apps/web/dist`
- Node version: 22.19.0 or newer
- pnpm version: 10.18.3, matching `packageManager`
- Build variable: `VITE_API_BASE_URL=https://YOUR-API-ORIGIN`

If the provider already installs dependencies, the build command can be `pnpm build`; confirm it used the lockfile and intended pnpm version. The app is a single workstation without deep-link route requirements. Review Pages' current [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) when creating the project. Configure production and preview origins deliberately on the API before testing.

Do not put Qloo, LLM or database secrets in Pages' public Vite variables. Pages hosts the UI; its presence does not run the Node API.

## 7. Railway API

Use the repository-root `Dockerfile` as the build source and the root directory as build context. Railway detects that Dockerfile; see its [Dockerfile guide](https://docs.railway.com/builds/dockerfiles). Use the image's command, set `HOST=0.0.0.0`, and let the platform supply `PORT`. Set the health check path to `/healthz`; [Railway health checks](https://docs.railway.com/deployments/healthchecks) target the injected port.

Set the API variables from sections 2–3 in private service configuration. Add `DATABASE_URL` if you want persistent history. Start with one instance. Set the resulting HTTPS API origin as the frontend's `VITE_API_BASE_URL`, rebuild the web bundle, and then perform the acceptance checks below.

## 8. Render details

`render.yaml` is a single-service Docker blueprint (see the 5-step guide above). It configures the free plan, `/healthz`, one instance, secure same-origin cookies (`COOKIE_SAME_SITE=lax`), `QLOO_API_KEY` as a dashboard secret and a prompt for `ALLOWED_ORIGINS` (the service's own URL). Sections 6 and 7 describe the split-host fallback. It intentionally does not provision a database or bake in provider keys. It selects `QLOO_TRANSPORT=harness` and the hackathon origin. Add optional secrets in the service dashboard and select an appropriate plan yourself; provisioning can incur charges.

Review the current [Render Blueprint reference](https://render.com/docs/blueprint-spec) before applying the file. With no database secret, the service is an ephemeral demo and loses its state on restart/redeploy.

## 9. Hosted acceptance checklist

- [ ] `/healthz` returns success on the intended HTTPS API origin
- [ ] Web assets load without mixed-content errors and call the intended API
- [ ] A cookie is accepted and sent on the next request in the target browser
- [ ] Approved origins work; an unrelated Origin is rejected
- [ ] Generate, approve, invalidate, repair, compare and export work across a reload
- [ ] Two separate browser sessions cannot read or mutate each other's state
- [ ] Missing provider keys and unavailable live evidence remain clearly labelled
- [ ] PostgreSQL restart persistence has been checked, or ephemeral mode is disclosed
- [ ] Real Qloo gate is either demonstrated with report evidence or labelled unverified
- [ ] Public exposure, privacy, retention, quotas, costs and rate limits have been reviewed

## Troubleshooting

- **UI loads but API fails:** verify the public build-time API origin, rebuild, check HTTPS and exact CORS origin. The browser cannot use a private database/service hostname.
- **Session resets on every request:** inspect third-party cookie blocking, `SameSite`, Secure, `credentials: include`, and whether the API is load-balanced across memory-only instances.
- **403 on mutation:** inspect the Origin against the allowlist. Do not replace the allowlist with a wildcard to hide the error.
- **State gone after restart:** check whether `DATABASE_URL` was actually supplied and migration startup succeeded. Memory mode does not persist.
- **Qloo unavailable:** check provider/account access with the probe. A missing key, incomplete candidate universe or stale response is not a passing gate; remain in labelled DEMO mode.
- **Deployment health check fails:** confirm `HOST`, injected `PORT`, startup migration logs and the `/healthz` route. A frontend-only host cannot start the API.

No hosting path here has been verified merely by documenting it. Record the actual environment and acceptance results in your release validation record.
