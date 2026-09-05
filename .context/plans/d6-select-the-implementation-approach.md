The safe stronger framing is: **“AI-generated documentation risk is creating payment leakage.”** The product’s action remains “hold for analyst review,” backed by evidence.

### D6 — Select the implementation approach

Reply with **A, B, or C**.

ELI10: All three approaches can tell the same story, but they spend the 24 hours differently. We must choose whether to optimize for one irrefutable investigation, a broad executive dashboard, or an ambitious provenance concept.

Recommendation: **A**, with B as the explicitly gated expansion, because it gives the team one excellent experience before adding breadth.

A) **Evidence Ledger** *(recommended)*  
Completeness: 10/10 for the primary analyst workflow.

- One seeded synthetic claim packet with a claim, clinical note, and policy excerpt.
- Deterministic checks find unsupported, contradictory, duplicate, or AI-documentation-risk signals.
- Each flagged line opens an evidence ledger: claim amount, source quote, rule/check, confidence, and “hold for analyst review.”
- Record the analyst’s accept/reject decision to establish the future feedback-loop moat.
- Conditional expansion: add B’s queue only after this flow works end-to-end.

B) **Batch Sentinel**  
Completeness: 8/10.

- Start with a ranked queue of 25 seeded claims, exposure totals, and provider-level trends.
- Reuse A’s ledger for the top case.
- Stronger MLR presentation, but requires enough consistent synthetic data that the queue does not look fabricated or arbitrary.

C) **Provenance Graph**  
Completeness: 6/10.

- Visualize how billed services, note excerpts, templates, and claim lines connect or fail to connect.
- Most distinctive visual, but it risks becoming a beautiful concept without a clear analyst decision workflow.

Net: **A is the product proof; B is the scale story; C is an optional visual flourish, not the MVP.**