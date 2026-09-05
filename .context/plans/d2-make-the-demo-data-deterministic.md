## D2 — Make the demo data deterministic?

The dashboard needs believable provider discrepancies, but a live NPPES fetch adds network, rate-limit, and data-shape failure points without improving the judges’ experience. A checked-in fixture gives every engineer the same records and makes the demo repeatable.

Recommendation: **A** because it keeps the data story credible while removing an unnecessary live dependency.

A) **20 synthetic records with 8 planted discrepancies (recommended)** — Completeness: 10/10. Commit one validated JSON fixture, include all four discrepancy types, seed SQLite from it at startup, and label the dataset “synthetic demo data.” *(human: ~30 min / CC: ~5 min)*

B) **100 records generated from a cached NPPES snapshot** — Completeness: 8/10. It looks more realistic but introduces acquisition and normalization work that does not affect the live demo flow. *(human: ~1–2h / CC: ~15 min)*

C) **Fetch NPPES live during the demo** — Completeness: 4/10. It demonstrates a future ingestion path but makes the presentation depend on an external API and potentially unstable source data. *(human: ~2h / CC: ~20 min)*

Net: this chooses repeatability versus data-source realism. Reply with **A**, **B**, or **C**.