# Claim Integrity

Screening support for healthcare claims. It answers two questions,
and keeps them apart:

**Axis one — the claim.** Deterministic rules over the line items,
then a separate pass where a model reads the clinical note against
what was billed. Every finding records which of the two raised it.
Output: a risk score, and `low` / `review` / `high`.

**Axis two — the provider record.** An agent panel checks the
provider against the federal registry. Slow, fallible, and never
allowed to block intake — if it fails, the claim is still assessed
and the provider is reported as unverified. Output: a data
confidence score, and `confirmed` / `probable` / `incomplete` /
`conflicting`.

Answering them together is how a coding error turns into an
accusation, so they are composed only at the routing step, and the
interface never blends them into one number.

**And a finding is not a verdict.** A provider can answer it. The
appeal runs the same claim again against what they have corrected —
the rules check whether the flagged lines are actually resolved, and
a model reads the letter. Where those two disagree, both readings
stay on the record rather than one quietly winning.


## Run it

```bash
npm install
npm start          # http://localhost:3000
```

Two front ends over the same API:

| | |
|---|---|
| `/` | the working dashboard — submit, review, appeal, provider calls |
| `/story` | a scroll narrative through the same pipeline, eight scenes |

For the provider axis against local fixtures rather than the live
federal registry:

```bash
./run-local.sh     # :3101 registry fixture, :3102 practice sites, :3000 app
```

Every fixture NPI begins with `9` — a range CMS has never assigned —
so no real provider can be implicated.


## Demo script

1. `/story`, scene 3 — drop `demo/claim_06_high_duplicate.csv`.
2. Scene 4 shows the rules pass and the evidence review as separate
   stages, then the registry check.
3. Scene 5 puts both axes side by side. Scene 6 lists every finding
   with the pass that raised it.
4. Scene 7 — drop `demo_appeal/appeal_06_WORKS_duplicate_removed.txt`.
   The duplicate is gone, and the appeal resolves.
5. Try `demo_appeal/appeal_09_FAIL_duplicate_still_present.txt`
   against the same claim. It does not resolve, and the interface
   says why. An appeal that always succeeds is not a review.
6. Scene 8 — every claim plotted by both axes, and every appeal with
   what the rules and the model each concluded.


## Examples

```bash
npm run example         # the orchestration end to end
npm run example:merge   # how rules and AI findings are merged
npm run example:call    # the provider call path
npm run example:demo    # every demo file through the pipeline
```


## Layout

```
orchestration/     axis one — rules, evidence review, the merge, routing
verification/      axis two — federal registry, coverage, outreach
analyzer.js        the deterministic rules
appeal-analyzer.js do the corrected lines resolve what was flagged
vapi.js            provider clarification calls
website/           both front ends
demo/              claim fixtures (CSV)
demo_appeal/       appeal fixtures (TXT)
```

Screening support only. Observations indicate what a person should
look at — not fraud, and not a coverage determination. Provider bands
describe the state of the evidence, never the character of a
provider.
