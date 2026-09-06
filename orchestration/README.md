# Orchestration

The workflow has three stages:

```
claim  ─→  orchestrateClaim         risk + routing
call   ─→  orchestrateProviderCall  clarification
appeal ─→  orchestrateAppeal        outcome
```

The two REVIEW stages are the same four steps:

```
deterministic reviewer  ─┐
                         ├─→  reconcile  →  route  →  decision record
AI reviewer             ─┘
```

`pipeline.js` owns those four steps. The claim and appeal orchestrators are
configuration of it — they supply the reviewers and say how the two opinions
combine. The call stage is not a review, so it does not use the pipeline; it
acts on the decision the claim stage already made.

| | claim stage | appeal stage |
|---|---|---|
| entry point | `orchestrateClaim(claim)` | `orchestrateAppeal(originalClaim, appeal)` |
| deterministic reviewer | `analyzer.js` | `appeal-analyzer.js` |
| AI reviewer | `ai-reviewer.js` | `appeal-ai-reviewer.js` |
| reconcile | the reviewers **add** to one shared finding list; worst surviving severity wins | the reviewers **judge the same original findings**; the more conservative opinion wins |
| routes to | `auto_clear` / `human_review` / `priority_human_review` | `close_appeal` / `human_review_remaining` / `human_review_unresolved` |

Between the two sits the voice agent.

## The provider call

`orchestrateProviderCall(claim, decision)` runs when — and only when — the
claim stage routed a claim to a human. It calls the provider's billing contact
and asks about the findings, so the reviewer picks the claim up with the
provider's answer already attached.

It owns whether a call happens, the brief the agent reads, and persisting the
call and its transcript. It does **not** own the call: `vapi.js` still owns the
outbound request, the one-at-a-time queue, and the polling.

The brief is ordered worst finding first, because a phone call is linear.
Nothing is dropped — a finding left out of the call is a finding the provider
never got asked about.

Two things are injected, which is what makes the stage testable:

- `store` — `{ createVapiCall, updateVapiCallStatus, completeVapiCall }`, so
  the orchestration layer has no database import of its own
- `queue` — defaults to `queueVapiCall`; the examples replace it with a fake
  that plays a call lifecycle back without dialling

The call runs in the background. Claim analysis never waits on a phone call,
and a store failure is logged and swallowed rather than taking down a call
already in progress.

The call gathers clarification. It does not negotiate, accept an explanation,
close a finding, or make any payment decision.

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

- **No Anthropic API key** → `available: false`, rules-only decision.
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
npm run example        # every scenario, all three stages, end to end
npm run example:demo   # the shipped demo/ and demo_appeal/ files
npm run example:call   # the call lifecycle, against a fake Vapi queue
npm run example:merge  # the claim-stage merge in isolation
```

None of them touch the database, start a server, or place a call. Without an
`ANTHROPIC_API_KEY` each run is fully deterministic and every expectation is
checked; with a key they run hybrid, still check the deterministic layer, and
report the merged result without asserting it.

`example:demo` is the one that protects a live demo: it checks that every file
in `demo/` and `demo_appeal/` still produces the outcome its filename promises,
so an edited threshold or an edited demo file cannot quietly break the script
you are about to walk someone through.
