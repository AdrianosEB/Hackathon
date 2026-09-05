# Claim Evidence Ledger — 24-Hour Hackathon Plan

## Summary

Build a payer-side payment-integrity copilot for claims analysts. It flags billed lines whose clinical evidence is missing, explicitly contradictory, or suspiciously reused, then shows the exact source evidence and recommends **hold for review**.

The pitch: “When AI makes a bill look plausible, we verify whether every line earned payment.” This differs from provider-side workflow automation such as [Tennr](https://www.tennr.com/product) by producing a payer analyst’s source-cited payment-review packet.

Approved record: [design doc](/Users/andreavaso/.gstack/projects/AdrianosEB-Hackathon/andreavaso-review-engineering-plan-design-20260905-105827.md).

## Implementation Changes

- Use React + FastAPI + local SQLite.
- Seed one fully synthetic claim, `CLM-001`, with six lines; flag the MRI, therapy, ECG, and remote-monitoring lines while clearing the office-visit and venipuncture lines.
- Implement deterministic `missing_support`, `explicit_contradiction`, and `reused_support` checks. An LLM may summarize evidence but never determines risk.
- Model `Claim`, `ClaimLine`, `SourceDocument`, `EvidenceExcerpt`, `Finding`, `AnalystDecision`, and `ClarificationRequest`.
- Build the analyst flow: case exposure → ranked findings → evidence ledger with exact quotes → hold/clear/escalate decision.
- Add the optional clarification loop only after the hour-10 core gate: an analyst approves a request for the missing ECG tracing; the agent calls only a consenting `DEMO_BILLING_CONTACT`, discloses it is a hackathon demo, and uses synthetic data. A replayed transcript is the required fallback.
- Keep the 25-claim Batch Sentinel queue deferred unless both the core ledger and call fallback finish early.

## Delivery and Test Plan

- Hours 0–2: freeze fixtures, expected findings, and API contract.
- Hours 2–6: build the rules/API and React evidence-ledger vertical slice in parallel.
- Hours 6–9: add citations, SQLite decisions, reset flow, and UI states.
- Hour 10: offline rehearsal. If flawless, spend up to four hours on the consented call; abandon live telephony by hour 12 if it fails rehearsal and use replay.
- Hours 14–24: harden, rehearse the 90-second walkthrough, and verify offline fallback.

- Test deterministic positive/negative cases for every rule, invalid decisions, webhook authentication/idempotency, call-fixture replay, UI states, reset, and the offline demo path.

## Assumptions

- No PHI, real provider contacts, arbitrary uploads, automatic denials, or fraud determinations.
- Production outreach would require organization-specific privacy, authorization, and minimum-necessary controls; the hackathon demonstrates only a consented synthetic scenario. [HHS guidance](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/disclosures-treatment-payment-health-care-operations/index.html)
- Do not compare directly with “Interor” until its correct spelling or URL is available.
