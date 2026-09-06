# Orchestration

Both stages of the workflow are the same four steps:

```
deterministic reviewer  ─┐
                         ├─→  reconcile  →  route  →  decision record
AI reviewer             ─┘
```

`pipeline.js` owns those four steps. The two orchestrators are configuration
of it — they supply the reviewers and say how the two opinions combine.

| | claim stage | appeal stage |
|---|---|---|
| entry point | `orchestrateClaim(claim)` | `orchestrateAppeal(originalClaim, appeal)` |
| deterministic reviewer | `analyzer.js` | `appeal-analyzer.js` |
| AI reviewer | `ai-reviewer.js` | `appeal-ai-reviewer.js` |
| reconcile | the reviewers **add** to one shared finding list; worst surviving severity wins | the reviewers **judge the same original findings**; the more conservative opinion wins |
| routes to | `auto_clear` / `human_review` / `priority_human_review` | `close_appeal` / `human_review_remaining` / `human_review_unresolved` |

## Decision record

Both orchestrators return the same shape:

```js
{
  stage,      // "claim" | "appeal"
  subject,    // claim number
  mode,       // "hybrid" when AI participated, otherwise "rules"
  rules,      // deterministic reviewer output, untouched
  ai,         // AI reviewer output, untouched
  verdict,    // the combined conclusion
  routing,    // what happens next
  trace,      // [{ step, status, ms, detail }] for each of the four steps
  durationMs
}
```

`rules` and `ai` stay separately visible on purpose. A reviewer looking at a
flagged claim can always see which of the two raised it, and stored claims
carry `rulesRiskLevel` and `aiRiskLevel` alongside the final `riskLevel`.

The claim orchestrator also attaches `.analysis`, and the appeal orchestrator
`.rulesReview` / `.aiReview` / `.finalOutcome` / `.workflowStatus`, which are
the names `db.js` and the frontend already use.

## AI never blocks a decision

The deterministic layer is the floor. AI can only ever move a decision toward
*more* human attention, never less:

- **No API key** → `available: false`, rules-only decision.
- **Request throws** → caught, rules-only decision.
- **Request exceeds `AI_TIMEOUT_MS`** (default 30000) → rules-only decision.

In the claim stage the merge escalates a finding's severity and never lowers
it. In the appeal stage the reconciliation matrix in `appeal-orchestrator.js`
lets AI downgrade an outcome but never fully clear one the rules still hold.

## Merging claim findings

An AI finding attaches to a deterministic finding on the same procedure code,
preferring one whose type matches the AI's stated reason (`REASON_AFFINITY`).
Each deterministic finding accepts at most one AI opinion, so a code carrying
two findings — say a duplicate *and* a price outlier — keeps both AI opinions
on the right findings instead of collapsing them onto the first one.

An AI finding with no procedure code, or one with no unclaimed match, is added
as its own `detectedBy: ["ai"]` finding.

`npm run example:merge` demonstrates exactly this, with no network call.

## Boundaries

Unchanged from the reviewers themselves. Nothing here determines fraud,
approves or denies a claim, makes a payment decision, or makes a medical
judgement. It decides which work items a human looks at, and in what order.

## Examples

```bash
npm run example        # all scenarios, both stages, end to end
npm run example:merge  # the claim-stage merge in isolation
```

Neither touches the database or starts a server. Without an `OPENAI_API_KEY`
the run is fully deterministic and every expectation is checked; with a key it
runs hybrid, still checks the deterministic layer, and reports routing without
asserting it.
