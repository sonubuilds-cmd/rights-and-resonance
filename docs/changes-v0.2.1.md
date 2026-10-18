# v0.2.1 — Qloo verification and safe diagnostics

- Added a separate allowlisted `qloo-probe-summary.json` for sharing; raw evidence remains in the private local full report
- Probe now stops after authentication, access, rate-limit, network, upstream or harness failure instead of sending the rest of the catalogue requests; unfinished gates remain unverified
- Rejects credential echoes hidden by JSON escaping before raw evidence is retained
- Changing a film title or release year clears its old Qloo identity rather than applying the previous film's scores to the new title
- Deduplicates confirmed cohort seed identities, matching the probe's behavior and the adapter's unique-UUID contract
- Corrected the local-origin template to allow the documented localhost and Playwright 127.0.0.1 addresses; removed a development NODE_ENV default that could make Vite build development React
- Added a real-loopback HTTP workflow smoke command, Windows startup/private-key guidance, and nine regression tests
- All seven workspace package versions are 0.2.1; dependency specifiers and lockfile resolutions are unchanged

Verified: 74 unit/integration tests, root/web TypeScript, production web build, real HTTP generate/approve/revoke/repair/reapprove/export flow, and no-key probe. The official documented Qloo contract was checked again. No live Qloo calls were made, no real key was read or configured, and no deployment/publication occurred. Browser testing remains blocked by this environment; see `validation.md`.
