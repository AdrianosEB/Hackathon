# insuCheck

**insuCheck is a claim-screening workbench designed to call the billing contact before a person has to work a questionable claim.** When calling is enabled, it turns a flagged claim into a focused clarification call, saves the provider's response alongside the evidence, and gives the human reviewer a fuller record to act on. It does not decide fraud, medical necessity, coverage, or payment.

The central design choice is simple: a concern in the *claim* and uncertainty in the *provider record* are different problems. A duplicate service on a claim is a coding or documentation question. An NPI that cannot be matched in the registry is a data-quality question. Treating both as one "fraud score" would make the result less useful and unfairly imply intent.

## What happens to a claim

```text
claim submission
      │
      ├─ Claim review ─────── rules + optional evidence review ──► risk level
      │
      ├─ Provider check ───── registry specialists ──────────────► confidence band
      │
      └─ Needs review? ────── phone call to billing contact ─────► transcript + findings
                                      │                                     │
                                      │ no call for a clean claim             └─► human work queue
                                      ▼
                              clarification is saved
                                                                    │
provider response / appeal ───────────────────────────────────────┘
      │
      └─ Appeal review ───── re-check original findings ─────────► resolved or human review
```

Every route tells a reviewer **what needs attention and why**. It never turns an observation into an accusation about the provider.

### 1. Claim review: is there something in the billing to examine?

The deterministic rules inspect line items and return a score, a review amount, and individual findings. A line can raise more than one finding, but it only counts once toward the review amount.

| Observation | Rule | Review meaning |
| --- | --- | --- |
| Duplicate service | Same procedure code appears more than once on the same date | Check whether an extra line was billed in error. |
| Unusually high units | A line has 5 or more units | Confirm quantity and supporting documentation. |
| Price outlier | A known procedure is billed above 2.5× its demo reference amount | Check the amount and coding context. |
| Limited documentation | A high-intensity procedure has a supplied note shorter than 90 characters | Review whether the note supports the billed intensity. |
| Missing context | No diagnosis codes were submitted | Obtain the missing clinical context. |

The current reference amounts and high-intensity codes are intentionally hackathon demo policy in [`analyzer.js`](analyzer.js), not authoritative fee schedules. The highest finding severity sets the deterministic level: `low`, `review`, or `high`.

An optional AI evidence reviewer reads the clinical note against the billed services. Its findings remain separately labeled in the decision record. It can add a concern or raise a finding's severity, but it can never reduce the attention required by a deterministic rule. If no `ANTHROPIC_API_KEY` is set, a request fails, or the request times out, the workflow continues with the rules-only result.

### 2. Provider verification: can the provider record be corroborated?

This is a separate, non-blocking verification path. Specialists query the enabled registry sources and return evidence for provider identity and any other configured dimensions. A deterministic adjudicator turns those findings into a data-confidence score and one of these bands:

| Band | Meaning |
| --- | --- |
| `confirmed` | The available source evidence corroborates the submitted provider record. |
| `probable` | The record is substantially supported, with a limitation noted. |
| `incomplete` | The enabled sources could not fully check the record; this is a coverage limitation, not a provider conclusion. |
| `conflicting` | The submitted record and registry evidence disagree and should be reconciled. |

A registry outage, timeout, or unavailable source is recorded as `not_checked`; it never prevents the claim from being assessed. Provider verification is cached by NPI and source fingerprint so that the same evidence is not repeatedly requested.

### 3. The clarification call: ask before asking a reviewer to guess

The phone call is the operating handoff for any claim that reaches `review` or `high` risk. After the claim is saved, insuCheck builds a short brief from **every** finding, ordered from highest severity to lowest, and queues a call to the billing contact. Claim intake does not wait for the call: the workflow returns immediately, while the call status and eventual transcript are saved against the claim.

This changes the human's starting point. Instead of receiving only “procedure 99215 appears twice,” they can receive the original evidence plus the billing team's clarification or a record that the call could not be completed. The call gathers information; it does not negotiate, accept an explanation, clear a finding, or make a payment decision.

| Risk level | Call action | What the reviewer receives |
| --- | --- | --- |
| `low` | No call | A clear claim and its retained evidence. |
| `review` | Clarification call queued | Findings, call lifecycle, and any transcript that has arrived when the reviewer opens the claim. |
| `high` | Clarification call queued first | The same record, with priority human review. |

Calls are one-at-a-time and their status is persisted from creation through completion or failure. If calling is disabled or incomplete, the claim is still saved and routed for human review—the missing call never blocks intake.

### 4. Triage: which team should look next?

Only this final routing step considers both axes together, while preserving both results on screen:

| Claim review | Provider record | Route |
| --- | --- | --- |
| Blocking provider discrepancy | Any | Hold for `provider_data_review`; do not turn it into a claim edit. |
| `high` | `incomplete` or `conflicting` | Priority `combined_review`. |
| `high` | Confirmed or probable | `coding_review`; the provider match does not erase the billing question. |
| `low` or `review` | `conflicting` | Priority `provider_data_review` to reconcile the submitted record with the registry. |
| `review` | Any, or a provider record that is incomplete | General human review. |
| `low` | Confirmed or probable | Auto-process with the evidence retained. |

This is a queueing policy, not an adjudication engine. The code that implements it is deliberately readable in [`verification/index.js`](verification/index.js).

### 5. Appeal: can the original concern be resolved?

An appeal is evaluated against the *original* findings rather than re-scoring the claim from scratch. The deterministic appeal review checks whether the corrected lines actually remove the condition that caused each original rule finding. The AI reads the appeal letter as a separate opinion. Their outcomes are reconciled conservatively and both remain visible when they disagree. An appeal can close, retain a human-review item, or retain an unresolved priority item—it is not designed to automatically succeed.

## Run locally

```bash
npm install
npm start
```

Open <http://localhost:3000>. The same API supports two front ends:

| Path | Purpose |
| --- | --- |
| `/` or `/story` | A guided, scrollable walkthrough of the screening workflow. |
| `/dashboard` | The operational interface for submitting, reviewing, appealing, and inspecting provider checks. |

To run the provider path against local fixtures instead of the live federal registry:

```bash
./run-local.sh
```

This starts the registry fixture on `:3101`, practice-site fixture on `:3102`, and app on `:3000`. Fixture NPIs begin with `9`, an unassigned CMS range, so the demo cannot implicate a real provider.

## Configuration and safety defaults

Start from the provided template:

```bash
cp .env.example .env
```

The app runs without credentials. AI review is optional and falls back to deterministic rules. Provider verification defaults to deterministic stand-ins until live agents are enabled. Outbound calls are dry runs by default and require explicit configuration before any number can be dialed.

Important controls are documented inline in [`.env.example`](.env.example):

| Setting | Default behavior |
| --- | --- |
| `ANTHROPIC_API_KEY` | Enables optional AI claim and appeal evidence review. |
| `AI_TIMEOUT_MS` | Caps AI review time; default is 30 seconds. |
| `VERIFY_*` | Selects provider-verification dimensions. |
| `AGENTS_LIVE` / `AGENTS_RECORD` | Switches verification from deterministic stand-ins to agents and controls recording. |
| `DEMO_AUTO_CALL` plus the Vapi credentials and `DEMO_BILLING_CONTACT` | Enables the central claim-clarification call. It is off by default. |
| `VAPI_TARGET_MODE=demo` | Keeps the separate outreach adapter on the configured demo number using synthetic data. Production requires a separate acknowledgement. |
| `OUTREACH_OPERATORS` or `OUTREACH_SHARED_SECRET` | Required to approve outreach requests. |

Never commit `.env` or real credentials. For the demo, use one fixed number with synthetic fixtures. The separate provider-record outreach flow adds approval, registry-sourced contact details, and production acknowledgement requirements before it can contact a real practice.

## Demo walkthrough

1. Open `/story` and, in scene 3, load `demo/claim_06_high_duplicate.csv`.
2. The duplicate routes the claim to a clarification call. With demo calling configured, the billing contact hears every finding, starting with the most severe; the call and transcript are retained on the claim.
3. Watch the deterministic rules, optional evidence review, and provider verification appear as separate stages.
4. In scenes 5 and 6, inspect the two axes side by side, the call record, and the pass that produced each finding.
5. In scene 7, submit `demo_appeal/appeal_06_WORKS_duplicate_removed.txt`. The duplicate is gone, so the appeal resolves.
6. Submit `demo_appeal/appeal_09_FAIL_duplicate_still_present.txt` against the same claim. It remains open because the original condition is still present.
7. Scene 8 shows claims plotted by both axes and the rules/AI result for every appeal.

## Commands

```bash
npm start              # start the application
npm run dev            # restart automatically while editing server.js
npm run example        # run every orchestration scenario end to end
npm run example:demo   # validate all shipped claim and appeal demo files
npm run example:merge  # demonstrate rules/AI finding reconciliation
npm run example:call   # exercise the provider-call lifecycle with a fake queue
```

The example commands do not start the server, touch the database, or place a call. Without an Anthropic key they are deterministic; with a key they still assert the rules layer and report the hybrid result. `example:demo` is the quickest safeguard before presenting: it checks that each fixture continues to produce the outcome promised by its filename.

## Architecture

```text
website/                     Story and dashboard front ends
server.js                    HTTP API, persistence boundary, and workflow wiring
analyzer.js                  Deterministic claim rules and risk calculation
ai-reviewer.js               Optional clinical-note evidence review
orchestration/               Reusable claim, appeal, and provider-call pipelines
appeal-analyzer.js           Deterministic re-evaluation of original rule findings
verification/                Registry evidence, confidence adjudication, triage, outreach
vapi.js                      Queued provider clarification calls
demo/                        Claim CSV fixtures
demo_appeal/                 Appeal-text fixtures
fixtures/                    Local registry and website fixtures
```

The review pipelines retain the rule output, AI output, merged verdict, routing, and timing trace. See [`orchestration/README.md`](orchestration/README.md) for the reconciliation rules and decision-record shape.

## Scope

insuCheck supports review prioritization. Its outputs identify observations for a person to inspect; they are **not** findings of fraud, coverage determinations, payment decisions, medical judgments, or statements about a provider's character.
