# v0.2.0: Qloo hackathon alignment

- Pinned the official `@qloo/qloo-harness` dependency to **0.1.26** and raised the Node minimum to **22.19.0**.
- Selected the kit's **`qloo api` route**, invoked through the package's public `runQloo` entry point in a bounded server child. The adapter uses `api search`, `api entity` and `api insights`; it does not use the `qloo_rank` workflow.
- Made `harness` the default transport. Direct HTTP remains an explicitly selected compatibility option; failures never trigger an automatic transport or credential fallback.
- Restricted both transports to `https://hackathon.api.qloo.com`. The child explicitly configures the upstream harness's base URL and matching trust setting, avoiding its production default.
- Preserved original response envelopes, HTTP status and `Retry-After` at the harness request boundary before CLI output formatting. Evidence identifies the transport and harness version/command. Provider-requested delays are honored or reported as exceeding the bounded wait budget, never shortened.
- Added credential-free local version/capability readiness. Local readiness and key presence remain separate from live provider verification, which is still **UNVERIFIED** without authenticated probe evidence.
- Updated setup, environment, deployment and live-gate documentation against the official kit and current developer guide. The [alignment guide](hackathon-alignment.md) records exact sources and known upstream discrepancies.

See [validation](validation.md) for executed checks and outstanding limits. Mocked transport tests and a working synthetic demo do not prove live Qloo coverage, quota, explainability, licensing rights or event eligibility. No real API call, deployment, repository publication or competition submission is claimed by this release note.
