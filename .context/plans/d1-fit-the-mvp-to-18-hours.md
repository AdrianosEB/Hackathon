D1 — Fit the MVP to 18 hours

The approved design assumes 24 hours and reserves four post-core hours for a live clarification call. With three engineers and 18 hours, keeping live telephony risks losing the reliable offline analyst workflow that judges must see.

Recommendation: A because it preserves the full product proof while removing the least reliable integration from the critical path.

A) Core ledger + simulated clarification replay (recommended). Completeness: 10/10. Build the deterministic claim review, evidence citations, analyst decisions, SQLite reset, and a local replayed clarification result; defer all live Vapi dispatch/webhook work. This gives one complete, offline-safe flow and clean ownership boundaries for three engineers. Human: ~18h / agent: ~2h. Downside: no actual phone-call theater.

B) Retain optional live telephony. Completeness: 7/10. Build the same core product, then attempt the consented call only after a strict hour-12 core gate; abandon it by hour 14 if rehearsal fails. This can add a memorable moment, but concentrates integration and credential/tunnel risk into the final hours. Human: ~18h / agent: ~2h. Downside: less hardening and rehearsal time.

C) Evidence ledger only. Completeness: 8/10. Ship the strongest possible detection-and-review screen without any clarification loop. It is the most reliable delivery, but leaves the “what happens after the analyst holds the line?” story unresolved. Human: ~15h / agent: ~1.5h. Downside: less differentiated end-to-end narrative.

Net: reply with A, B, or C.