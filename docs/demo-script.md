# Five-minute demo script

## Before presenting

Start with `pnpm dev` and open http://localhost:5173. Use **Reset demo** in the browser you will present. Select **DEMO** mode. Check that the synthetic evidence label is visible and the API is reachable. Do not rely on a previously generated version from another browser session.

The fixture is intentionally fixed: fictional Lantern Cinema, 30 films, Film Society / Alternative Music / Gaming & Speculative Fiction cohorts, four screening slots on 16–17 October 2026 and GBP 1,850 budget. Use the displayed catalogue rather than claiming present-day licence availability.

## 0:00 — State the problem and the boundary

“This is a cinema-programming workstation. It chooses a feasible four-screening programme, shows how the slate serves three cohorts, and preserves a review trail when something changes. Today's rights, fees and affinity scores are synthetic. This demonstrates the real solver and approval/repair workflow; it does not claim real Qloo evidence or screening rights.”

Open **Audience cohorts**. Show the cross-domain seeds and explain that these are fictional group taste profiles, not individual customer records or attendance predictions.

## 0:45 — Generate a feasible slate

Open **Programme canvas**, then **Generate programme**. Show the draft status, four screenings, total licence cost and cohort coverage. Explain the actual priority: serve the least-covered cohort first, then average coverage, metadata diversity and savings. The scores represent relative affinity ranks, not expected tickets sold.

Open the evidence view for a selected film/cohort. Point to the source label and timestamp. Show the rights, runtime and format context. No model can grant a missing licence or exceed the budget.

## 1:45 — Make approval explicit

Choose **Approve programme**. Point to the exact approved version. Explain that generation creates a draft; a person decides whether to approve it. Approval here is a prototype workflow action, not a contract with a rights holder.

Keep the approved version in view long enough to establish the “before” state.

## 2:15 — Withdraw rights and repair

On one selected film, open its rights-withdrawal action and confirm **Withdraw rights & repair**. This is a simulated ledger change. Do not choose an arbitrary unselected film: the purpose is to make the approved selection infeasible.

Open **Repair review**. Show that the prior approval is invalidated and a new draft has been created. Compare the kept films, replacement, cost and coverage. The default repair policy prefers fewer slot changes before optimizing the cohort objective. It does not silently re-approve the replacement.

If no feasible repair exists, show the explicit failure and explain which constraint needs attention. Do not describe an empty or partial slate as success. To repeat the prepared happy path, reset the fixture and start again.

## 3:20 — Review the replacement

Inspect the replacement's rights/evidence, then choose **Approve repair**. Switch between the old and new versions: old items and evidence are retained; the old status records why it became invalid. Each version has its own identity and the repair links back to its parent.

## 4:00 — Export and compare

Use **Export programme** and inspect the JSON packet's version, approval status, source labels, screenings and costs. Only a currently approved, revalidated programme is exportable. If demonstrating **Rights enquiry draft**, describe it as a draft for human review; no rights holder has been contacted and no licence is purchased.

Open **Evaluation lab**. Run only the comparisons configured for this environment. Missing Qloo or LLM credentials should appear as unavailable. Local metadata and synthetic scores do not establish which provider is better. Different candidate universes must be called out rather than compared as an apples-to-apples benchmark.

## 4:45 — Close honestly

“The end-to-end local workflow works without a provider key: generate, inspect, approve, invalidate and repair. Live Qloo evidence still needs a real account/key, confirmed entities, complete comparable responses and observed explanations. Rights remain synthetic until a real authorised source replaces them.”

## If someone asks about the live API

Show the actual `reports/qloo-probe.json` result and [live validation checklist](live-validation-checklist.md). A no-key `UNVERIFIED` result is the correct outcome when no key was supplied. Do not present the probe script's existence as a passed test.

## Short version

1. Synthetic labels + four constraints: rights, time, format, budget
2. Generate draft + cohort coverage
3. Human approval
4. Withdraw a selected film's rights
5. Invalidated old version + repaired draft
6. Human approval + versioned export
7. Live-Qloo gate remains unverified without account evidence
