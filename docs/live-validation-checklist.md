# Live validation gate: not yet passed

**The standalone synthetic workflow and the live Qloo hackathon demonstration have different acceptance criteria.** A working local UI, implemented adapter and passing CPU solver tests do not establish live provider access or satisfy live-data demonstration requirements.

No real Qloo key was supplied for this build. The live account gate must be recorded as **UNVERIFIED**, not failed and not passed. Hosting, public-repository publication and hackathon submission were **not performed**. Do not claim the hackathon definition of done is complete.

## Installation and event configuration

Before sending any request, follow [hackathon alignment](hackathon-alignment.md): Node >=22.19.0, pinned harness 0.1.26, explicit `QLOO_TRANSPORT=harness`, hackathon origin, and a private individually attributable event key. Record local harness readiness separately from live availability. A passing version/help or dry-run check is not authentication evidence. Confirm the organizer's quota and expiry; neither referenced source supplies numeric limits.

The >=25 film mapping threshold and profile-difference criteria below are this project's technical gate, not official event eligibility rules.

## Required live evidence

Run `pnpm probe` with the intended server-side key and preserve the report with secrets excluded. Resolve issues before changing any status below.

Use [Windows quick start](windows-quick-start.md) for a private session-only key. Share `reports/qloo-probe-summary.json` only; the full raw-evidence report stays local. A probe pass does not import mappings into a browser session, approve a programme, or run the live UI workflow.

| Gate | Acceptance evidence | Current status |
| --- | --- | --- |
| Real account and API access | A successful authenticated request to the intended provider endpoint and account | UNVERIFIED: real key required |
| Film mapping coverage | At least 25 of the 30 catalogue films mapped to unique confirmed Qloo entities, with title/year checked and exclusions listed | UNVERIFIED |
| Ambiguity handling | Ambiguous film matches reviewed and confirmed by a person; no arbitrary first-result mapping | UNVERIFIED |
| Cross-domain seeds | Every seed required by all three cohorts resolved and confirmed in its proper entity domain | UNVERIFIED |
| Fixed candidate universe | Exactly the same recorded mapped film set requested for each cohort; no cohort-specific shrinkage | UNVERIFIED |
| Complete affinities | Every member of that set has a finite returned score for each cohort; partial results remain unknown | UNVERIFIED |
| Useful distinct rankings | All three ranking profiles are meaningfully useful and distinct on that same set; inspect differences manually in addition to the probe's pairwise heuristic | UNVERIFIED |
| Explainability | Provider explanations inspected in actual responses when available, with response provenance; no synthetic/model-generated narration relabelled as Qloo explanation | UNVERIFIED |
| Evidence provenance | Request parameters, timestamps, response identifiers/hash, cache/source status and candidate set captured without secrets | UNVERIFIED |
| Live workflow | Generate a draft from accepted live evidence, inspect it, explicitly approve, then simulate a rights change and review the new draft | UNVERIFIED |
| Failure handling | Missing mapping, partial response, rate limit, outage and stale cache cannot become an unlabelled live success | UNVERIFIED live; inspect mocked test coverage separately |

## What the probe can and cannot establish

The automated probe gives technical evidence about this account, catalogue and request shape at a particular time. Its distinct-ranking check is a simple heuristic; it cannot decide whether differences are useful to a programmer. Entity search candidates still need title/year/domain review. A successful request does not verify every downstream workflow, nor guarantee future account access, response completeness or quota.

Actual returned explainability must be examined. If the provider does not return explanation fields for this account/request, record that limitation explicitly; do not fill it with invented “Qloo reasons.” Keep concise application explanations separate from provider data.

Preserve missing scores as unknown. Never repair an incomplete live response by taking synthetic values, filling zeros, dropping different films for each cohort or relabelling old cached responses as fresh. Rank-normalize only the complete fixed universe used by all cohorts.

## Solver validation is a separate track

The CPU solver can be verified without any provider. Record actual test output for hard constraints, rank normalisation, tied scores, missing evidence, maximin objective, deterministic ties, locks and repair policies. Record API tests for approval, invalidation, immutable selection/evidence history, session isolation and export separately.

A pass on that track means the implementation handled the tested synthetic/mocked inputs. It says nothing about Qloo coverage, real rights availability, model output quality, demand prediction or commercial outcomes. See the [delivery validation record](validation.md) for the checks actually performed on this archive.

## Before a public demonstration

- Verify any current hackathon eligibility, deadline and submission requirements against the official rules
- Confirm rights/fees remain prominently marked synthetic even when affinities become live
- Verify the exact hosting/browser session flow, including cookies, origins and restart persistence
- Review the exposure of provider-backed endpoints, usage limits and potential API costs
- Obtain authorization before publishing the repository, deploying publicly or submitting
- Record which checks actually passed, which failed and which remain unverified

Do not paste provider keys, database credentials or session cookies into this report, source control, screenshots or the submission video.
