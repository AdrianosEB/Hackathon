## D6 — Add a compact automated test pack

The original plan treats the live demo as the test suite. That leaves the most failure-prone logic—discrepancy scoring, call-result state transitions, webhook idempotency, and UI state rendering—untested right before the demo. These are small, deterministic tests and do not require real telephony.

Recommendation: **A** because it covers every critical branch without attempting a slow full browser/telephony suite.

A) **Lean automated confidence pack (recommended)** — Completeness: 10/10. Add `pytest` tests for fixture validation, flag scoring, trigger validation, webhook signature/idempotency, and classifier fallback; add `Vitest` component/API-state tests; run one local fixture-replay integration smoke test. *(human: ~1.5–2h / CC: ~20 min)*

B) **Manual checklist only** — Completeness: 4/10. It saves setup time but makes regressions and integration mistakes much more likely during the demo. *(human: ~30 min / CC: ~5 min)*

C) **Full browser E2E plus live Vapi tests** — Completeness: 9/10. It is robust but disproportionate for a 12-hour three-person build and still depends on external telephony. *(human: ~3–4h / CC: ~45 min)*

Net: test deterministic code automatically; validate the external live-call path once manually with the replay fallback ready. Reply with **A**, **B**, or **C**.