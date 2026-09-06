# Hackathon
## Claim + appeal integrity

One pipeline over two inputs: the claim record (codes, service dates, units, line
amounts) and the appeal text written about it. No website check, no external
lookup — every finding comes from one source, or from disagreement between them.

Open `/appeal.html` (linked from the claim dashboard), fill in the claim panel,
paste the appeal.

### The orchestration

```
   Claim record            Appeal text
        |                       |
        +----------+------------+
                   v
   1  INTAKE .............. segment the text, index the claim, pick the plan
                   |
   2  PARALLEL
        Claim Audit ....... duplicates, units, price outliers, thin notes
        Language Audit .... absolutes, accusation, vagueness, hedging   (per chunk)
        Figure & Date ..... arithmetic, sourcing, precision, contradictions
        Evidence .......... 14-item checklist, satisfied from BOTH sources
                   |
   3  CLAIM CROSS-CHECK ... does the appeal describe the claim that was filed?
                   |
   4  AI REVIEW (gated) ... only at score 40+, contributes questions only
                   |
   5  REPORT ............... merge, score, rank
                   |
        +----------+------------+
        v                       v
   Integrity score        Ranked questions
```

Six stages, down from nine. The reconciler, interrogator and report composer
collapsed into one stage; exaggeration and vagueness merged into the language
audit; numbers and consistency into the figure audit.

### What cross-check catches

The stage that only exists because the two halves are joined. An appeal can read
perfectly and still describe a different claim:

- A figure matching no billed line and no claim total
- A stated total that disagrees with what the lines add up to
- Procedure or diagnosis codes argued for that were never billed
- Billed lines the appeal never argues for, with the money at stake
- Service dates asserted in the appeal that are not on the claim
- Session counts that disagree with billed units

### Scoring

`100 − language penalty (max 60) − documentation penalty (4 per missing required
item, max 30)`, with findings weighted by severity × confidence and scaled by
`√(250 / words)` so density drives the score rather than volume.

**AI findings are excluded from the score.** Measured over two appeals, the AI
layer moved a well-documented appeal from 100 to 56 and a poor one not at all —
it penalised only the good appeal. It earns its place as a question generator,
so it is gated behind the deterministic screen and feeds questions only.

### Length tiers

| Tier | Words | Effect |
| --- | --- | --- |
| insufficient | 0–39 | claim audit, arithmetic, cross-check, completeness only |
| brief | 40–149 | every stage, single pass |
| standard | 150–599 | every stage, paragraph-level attribution |
| long | 600–1499 | language audit splits into parallel chunks |
| extended | 1500+ | as above, prioritised reporting |

### API

- `GET /api/appeal/orchestration` — the blueprint the UI diagram is drawn from
- `POST /api/appeal/analyze` — `{ "text": "...", "claim": {...}, "useAi": true }`

`claim` is optional; without it the claim audit and cross-check stages are
skipped and say so.

### Files

- `appeal/triage.js` — intake, measurement, routing
- `appeal/claim-index.js` — claim record → verifiable facts
- `appeal/agent-crosscheck.js` — text against the record
- `appeal/agent-*.js` — the deterministic detectors
- `appeal/ai-agents.js` — the AI counterparts, provider-aware, verbatim-quote guard
- `appeal/synthesis.js` — merge, questions, report
- `appeal/orchestrator.js` — the five stages, gating, timings
- `website/appeal.html` / `appeal.js` / `appeal.css` — the page
