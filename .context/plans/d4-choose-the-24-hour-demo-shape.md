A and B use the same evidence-ledger detail view. The difference is the opening screen and how much data we must make credible.

- **A: one deep case.** The demo opens a single suspicious bill and walks the judge through 2–3 bad lines, each tied to exact contradictory or missing clinical evidence. It proves, “this analyst now knows what to hold and why.”

- **B: a portfolio queue.** The demo opens a ranked list of 25 claims, such as “$48k at risk,” then drills into the worst one. It proves, “this insurer can prioritize a large queue,” but requires making many synthetic cases and their scores feel believable.

For a 24-hour hackathon, I recommend **A**, with a tiny non-interactive header like “$127k detected across this week’s batch” if you want an MLR-scale story without building B’s full queue.

### D4 — Choose the 24-hour demo shape

Reply with **A, B, or C**.

A) **One cinematic synthetic claim packet** *(recommended)*. One claim, clinical note, and policy excerpt with 2–3 planted evidence failures; the app gives a line-by-line, source-cited “hold for review” recommendation.

B) **Portfolio triage of 25 synthetic claims.** A ranked queue first, then a drill-down into the top case; broader MLR story but more data work and less depth.

C) **Live upload of arbitrary claim PDFs and notes.** More product-like but fragile, with parsing and model-output risks.