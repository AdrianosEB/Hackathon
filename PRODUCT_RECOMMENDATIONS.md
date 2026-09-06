# Claim Integrity: Hackathon-Winning SIU Workbench

## Summary

Position the product for payer Special Investigations Units: **help investigators prioritize reviewable claims, assemble defensible evidence, and close the loop with providers—without automatically labeling fraud or denying payment.**

The differentiator is not “AI catches fraud.” It is: **an evidence-first investigation workflow that preserves uncertainty, separates provider identity from claim behavior, and makes the next human decision obvious.**

## Business and product changes

- Rename the central workflow from “analyzed claims” to an **Investigation Queue** with three clear lanes: `Ready to clear`, `Needs investigator review`, and `Priority review`.
- Make each selected claim an **Investigation Brief** rather than a data dossier:
  - estimated dollars at risk / reviewed amount;
  - concise “why this was routed” explanation;
  - distinct claim-billing and provider-record evidence;
  - recommended next step: clear, request clarification, hold for review, or await appeal;
  - explicit human owner and final disposition.
- Add a **human disposition loop**: investigators record `cleared`, `referred`, `needs information`, or `corrected by provider`, plus a reason. This is the first credible source of outcome data for rule tuning and future model evaluation.
- Promote the appeal experience into a **Right of Reply** workflow: timeline from flag → provider notice/clarification → corrected submission → independent reassessment → investigator close-out. This is a fair, defensible, memorable demo.
- Replace generic provider analytics with an **SIU value dashboard**: reviewed dollars, cases prevented from escalation by correction, time-to-disposition, appeals resolved, and the proportion of cases cleared after review. Clearly label all demo KPIs as simulated.
- Keep the story page as the judge-facing narrative and the dashboard as the operational proof. Add an obvious handoff between them; do not spend the sprint merging their visual systems.

## Highest-value demo features

1. **One-click Investigation Brief**
   - Generates a shareable, printable case record with evidence, data provenance, model/rule status, and a named recommended next step.
   - Include an “evidence gaps” section so incomplete verification never appears as negative evidence.

2. **Case Timeline and Disposition**
   - Show every material event and actor: imported, rules reviewed, AI reviewed, registry checked, clarification approved/completed, appeal received, reviewer disposition.
   - This reinforces that automation recommends rather than adjudicates.

3. **Portfolio prioritization**
   - Rank work by review amount and severity, not risk score alone.
   - Add filters for routing state, provider-confidence state, finding type, and appeal status. Avoid cross-provider “suspicion rankings” until enough reliable historical data exists.

4. **Demo command center**
   - Start the presentation from a seeded case portfolio, not an empty upload control.
   - Provide a 90-second “happy path” and a 90-second “fairness/control path”: a clean alias match, a high-risk duplicate, and an appeal that genuinely resolves a case.

## Technical implementation changes

- Establish a first-class `case`/`disposition` record linked to a claim, appeal, clarification call, and reviewer decision. Persist actor, timestamp, decision, reason, and immutable decision inputs.
- Store decision provenance needed for defensibility: rule version, AI availability/model/prompt version, source name, source timestamp, and fallback/timeout status.
- Move hard-coded rule thresholds and reference prices into versioned policy configuration, retaining the deterministic rule engine. The UI should show the policy version, not expose editable logic in the hackathon build.
- Add a seeded demo dataset and reset mechanism so every judge sees a populated queue and predictable outcomes.
- Keep route and documentation behavior consistent: the server serves the story at `/` and `/story`, and the dashboard at `/dashboard`; preserve that handoff in future changes.
- Replace the invalid `node test.js` expectation with a real test script. Cover deterministic claim/appeal flows, API validation and persistence, disposition audit records, timeout fallbacks, and demo fixtures’ promised outcomes.

## Acceptance criteria

- A judge can open the app and immediately understand the SIU buyer, economic value, safety boundary, and next human action.
- A reviewer can complete a claim from queue → evidence brief → disposition in under a minute.
- The demo visibly proves all three trust controls: provider-record uncertainty is separate from claim risk; automation cannot auto-deny; a substantiated correction changes the outcome.
- Every decision shown in the UI has a traceable source and timestamp.
- The app has one passing, documented test command and no stale route or empty-state defects in the presentation path.

## Assumptions

- Optimize for a one-sprint hackathon build aimed at payer SIU judges/buyers.
- Do not claim fraud detection, payment authorization, clinical judgment, real savings, or production PHI compliance.
- Defer EDI/837 ingestion, payer-core integrations, state/OIG enrichment, production identity/SSO, and learning-based scoring to a pilot roadmap.
