The revised draft now makes the live call a controlled demo branch:

- Only after the hour-10 evidence-ledger gate.
- Only to `DEMO_BILLING_CONTACT`, owned by a consenting teammate.
- Mandatory “hackathon demo” disclosure, synthetic data only, one narrow artifact request.
- If it is not rehearsed successfully by hour 12, the app uses the saved transcript fixture through the same result screen.
- The batch queue is deferred.

One implementation decision now matters: a real call cannot safely originate from a static browser-only app because its telephony credential must stay server-side.

### D10 — Choose the build stack

Reply with **A, B, or C**.

ELI10: The core ledger can be static, but the optional live call needs a small server to keep the telephony secret private and receive the call result. The workspace currently has no application code; the prior plan mentioned FastAPI, SQLite, and React but did not implement them.

Recommendation: **A** because it gives three engineers clean boundaries and supports both live telephony and an offline replay with the least integration risk.

A) **React + FastAPI + SQLite** *(recommended)*. Note: options differ in kind, not coverage — no completeness score. React owns the evidence-ledger UI; FastAPI owns fixtures, deterministic rules, Vapi dispatch/webhook, and replay; SQLite stores local decisions and call state.

B) **Next.js + SQLite**. Note: options differ in kind, not coverage — no completeness score. One TypeScript codebase with route handlers for telephony. It is cohesive if the team already moves faster in Next.js, but there is no existing Next project to reuse.

C) **Static React demo only.** Note: options differ in kind, not coverage — no completeness score. Keep the call entirely replayed from a fixture; this is simplest but drops the optional live-call moment you selected.

Net: A preserves the reliable core and gives the live call a secure, disposable adapter.