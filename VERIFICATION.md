# Provider verification layer

Adds a second axis to Claim Integrity. Your existing `analyzer.js` asks *is this claim
anomalous?* This asks *is the entity billing it real?* — and routes on the combination.

---

## Do this first

`.env` is committed to a public repo. Anything in it is compromised.

```bash
git rm --cached .env claim-integrity.db claim-integrity.db-shm claim-integrity.db-wal
printf '.env\n*.db\n*.db-shm\n*.db-wal\nnode_modules/\n' >> .gitignore
git commit -m "Remove secrets and database from version control"
```

Then **rotate every key that was in it** — removing the file does not remove it from
history, and the repo has been public. If you want the history scrubbed too, that's
`git filter-repo` or a fresh repo; rotating the keys matters more.

---

## Vocabulary

Nothing in this system concludes fraud, and no output is phrased as though it might. Every
term describes **the state of the evidence**, never the character of a provider. "This
record does not match" is a statement about records. "This provider is suspect" is an
accusation, and we are in no position to make one.

**Provider axis — Data Confidence**

| Band | Means |
|---|---|
| `confirmed` | registry corroborates the submission |
| `probable` | mostly corroborated, minor gaps |
| `incomplete` | not enough matched to conclude — *a statement about our coverage* |
| `conflicting` | submission and registry disagree |

Per-check `result`: `match` · `partial` · `mismatch` · `not_checked`

**Claim axis — Review Priority**

`reviewPriority` 0–100, `reviewLevel`: `routine` · `review` · `priority`, and
`observations` rather than flags. Every observation carries an `innocentExplanation` field —
if you cannot name an innocent explanation for a signal, you do not understand it well
enough to ship it.

**Renamed throughout**

| Was | Now |
|---|---|
| `reliabilityScore` / `reliabilityBand` | `dataConfidenceScore` / `confidenceBand` |
| band `suspect` | band `conflicting` |
| band `verified` / `unverified` | `confirmed` / `incomplete` |
| `verdict` pass/warn/fail | `result` match/partial/mismatch |
| `vetoed` | `blocking` |
| `riskScore` / `riskLevel` / `flags` | `reviewPriority` / `reviewLevel` / `observations` |
| queue `investigations` | queue `priority_review` |
| queue `provider_integrity` | queue `provider_data_review` |

The agent prompts carry an explicit prohibition: *fraud, fraudulent, fake, scam, criminal,
suspect, bad actor, illegitimate, or any synonym* may not appear in any output. If a record
does not match, say the record does not match, and say which field.

Existing databases migrate automatically — `db.js` renames the legacy columns in place and
maps `low`/`high` to `routine`/`priority`, so old rows survive.

---

## Install

```bash
npm install @anthropic-ai/claude-agent-sdk zod
```

Add to `.env` (the *uncommitted* one):

```
ANTHROPIC_API_KEY=sk-ant-...
VERIFY_IDENTITY=true
VERIFY_RESEARCH=false   # tier 2, open web — advisory only, see "Two tiers" below
```

Drop `verification/` into the repo root and replace `server.js`. That's it —
`migrateClaimsTable()` adds the new columns to your existing database on boot, so your
current `claim-integrity.db` keeps working.

> The new `server.js` also fixes a live bug: your old one served static files from
> `/website`, which doesn't exist, so `/`, `style.css` and `script.js` all 404'd.

---

## What changed in the claim payload

```diff
  {
    "claimNumber": "CLM-10429",
    "providerName": "Northside Medical Center",
+   "npi": "1881018208",
+   "practiceAddressLine1": "200 1st St SW",
+   "practiceCity": "Rochester",
+   "practiceState": "MN",
+   "practicePhone": "507-284-2511",
    "diagnosisCodes": ["R10.9"],
    "lineItems": [ ... ]
  }
```

**The NPI is the whole ballgame.** `providerName` is free text — "Family Medical Center"
matches hundreds of real organizations and infinitely many fake ones. You cannot verify an
entity you can only identify by name. The NPI is optional (the demo still runs without it)
but the response will say plainly that the provider could not be identified.

Add those five fields to your form in `index.html` and to whatever `script.js` posts.

---

## Response shape

```jsonc
{
  "id": 42, "claimNumber": "CLM-10429", "reviewLevel": "high",   // ← unchanged
  "verification": {
    "dataConfidenceScore": 90,
    "confidenceBand": "probable",        // confirmed | probable | incomplete | conflicting
    "blocking": false,
    "coverage": {
      "checked": ["identity"],
      "skipped": [ { "id": "sanctions", "label": "Federal exclusions", "reason": "..." } ],
      "completeness": 0.21
    },
    "checks": [
      { "dimension": "identity", "finding": "pass", "confidence": 0.9,
        "summary": "...", "evidence": [ { "fact": "...", "sourceUrl": "..." } ],
        "limitations": "..." }
    ],
    "rationale": "...",
    "fromCache": false
  },
  "routing": {
    "decision": "review",                 // auto_process | review | priority_review | hold
    "queue": "coding_review",
    "headline": "...", "reason": "...", "note": "..."
  }
}
```

---

## How it works

```
POST /api/claims/analyze
   │
   ├── analyzeClaim()          deterministic rules      → claim risk      (instant)
   │
   └── verifyProviderCached()
          ├── cache hit by NPI? ────────────────────────→ return          (instant)
          └── Promise.all over enabled specialists
                 └── identity-verifier   (SDK agent, NPPES tools)
                 ·   sanctions-verifier  ┐
                 ·   location-verifier   │ declared, dark,
                 ·   web-verifier        │ one env flag away
                 ·   scope-verifier      │
                 ·   history-verifier    ┘
                         ↓
                    adjudicate()   blocking discrepancies + weighted average  → data confidence
                         ↓
                     triage()      two axes → one routing decision
```

### Three decisions worth understanding before you present this

**Dispatch is JavaScript, not a manager agent.** A "manager" that delegates to specialists
adds a round trip and a failure mode: it can decide on its own not to consult one, and you
find out on stage. `Promise.all` cannot forget. The specialists are still full SDK agents —
only the fan-out is deterministic. Adding a source does not add latency, because they all
run at once.

**The score is arithmetic, not a model output.** Agents produce findings and confidences —
the judgement calls. Converting those into a number is a *policy* decision, and policy
belongs in code you can read and argue with. Ask a model for "a score out of 100" and you
get a number nobody can reproduce.

**Blocking discrepancies bypass the arithmetic.** A deactivated NPI or a confirmed federal exclusion isn't
worth "some negative points" — it ends the assessment. This is the classic failure of
additive scoring: six soft passes quietly outvote one blocking discrepancy and an excluded
provider sails through with a 71.

### Outreach escalation

When automated verification comes back unclear, ask the provider. This is due process —
the alternative is marking a practice unverified without ever giving them a chance to answer.

```
verified / probable   → nothing happens
blocking discrepancy   → nothing happens; straight to provider data review
incomplete / conflicting  → tier 1: phone  → tier 2: email → tier 3: human
```

Four rules, each because the obvious implementation is wrong:

**Contacts come from NPPES, never from the claim.** The claim was submitted by the party
being checked. Ringing the number printed on it asks the party under review to vouch for themselves on
a line they chose — a confirmation that *looks* independent and isn't, which is worse than
not calling. If the registry has no contact details, outreach doesn't happen; there is no
fallback. (Confirmed under failure: with NPPES unreachable, `escalate()` refuses rather
than reaching for the claim's number.)

**A blocking discrepancy never escalates.** Failed check digit or federal exclusion means there is no
verified party to call, and calling tips off whoever submitted it.

**Nothing sends itself.** Every call and email is drafted and queued for a named human.
`dispatch()` is a dry run unless you deliberately wire an adapter. An autonomous system
that dials real clinics off an automated screening outcome is a different risk class —
TCPA, state AI-disclosure laws for calls, and the plain fact that a wrong number means
harassing a real practice.

**No PHI in outreach.** Scripts confirm provider details only — practice name, address,
NPI. Never the patient, diagnosis, codes, or amount. You are talking to a party you have
*not* verified; disclosing patient information to them would be the actual breach.

Plus a 14-day per-provider cooldown (a practice must not be rung once per claim) and a
business-hours call window in the practice's own timezone.

| Route | Does |
|---|---|
| `GET /api/outreach` | queue + active policy |
| `POST /api/outreach/:id/approve` | requires `approvedBy` — anonymous approval is refused |
| `POST /api/outreach/:id/dispatch` | dry run unless an adapter is wired |
| `POST /api/outreach/:id/outcome` | `confirmed` / `contradicted` / `no_answer` / `unreachable` / `refused` |

### Two tiers of agent

| | Tier 1 — verifiers | Tier 2 — research |
|---|---|---|
| Tools | typed registry lookups only | `WebSearch`, `WebFetch` |
| Output | `finding` + `confidence` | `leads` + quotes + URLs |
| Affects the score? | **yes** | **never** |
| Reproducible? | yes | no |
| Flag | `VERIFY_IDENTITY` etc. | `VERIFY_RESEARCH` |

Tier 2 is the open, Claude Code-style agent — it roams, searches, fetches, and works out
what matters. Its findings land in `verification.research` and go on the reviewer's screen
under an "unverified context" heading. `adjudicate()` never receives them, and its signature
makes that structural rather than a matter of discipline.

The reason is narrow and specific: **that agent reads pages authored by the party being
assessed.** A provider who knows their claims get screened this way can write anything they
like on their own homepage, including text addressed to an automated reader. A subject who
can author their own evidence must not be able to author their own finding. (The research
prompt turns this into a feature — if a page *does* contain instructions aimed at an AI
verifier, that gets recorded in `injectionAttempts`, which is itself worth a reviewer's time.)

Secondary reasons: open search on a named business reliably surfaces material about
*similarly named* businesses, and a score that moves on search results gives a different
answer every run.

### The honesty constraint

With only identity enabled, `completeness` is 0.21 and the band is **capped at `probable`**
no matter how clean the result. You cannot call a provider "confirmed" on one dimension.
This is deliberate, and it's also the most interesting thing to say to judges: the system
reports what it *didn't* check.

---

## Turning on Plan B

Every specialist is already written in `agents.js`. Enabling one is a flag.

| Flag | Cost | Work | Payoff |
|---|---|---|---|
| `VERIFY_SANCTIONS=true` | free | ~1hr — load the monthly LEIE CSV into SQLite ([download](https://oig.hhs.gov/exclusions/exclusions_list.asp); there is **no public API**) | Your strongest demo moment: "this provider is federally excluded" |
| `VERIFY_LOCATION=true` | billed key | Places `business_status` + USPS CMRA flag | Catches the mailbox-store clinic; Street View makes it visual |
| `VERIFY_WEB=true` | free | RDAP lookup + fetch the practice site | Domain registered days before the service date |
| `VERIFY_SCOPE=true` | free | needs a taxonomy→CPT plausibility table | Dermatologist billing abdominal CTs |
| `VERIFY_HISTORY=true` | free | query your own claims table | Address clustering — `providersAtAddress()` in `cache.js` is already written |

Each needs its tools built and wired into `tools.js` and the agent's `tools:` array; the
prompts, weights, and adjudication are done.

---

## Answering "do the offices actually exist?"

Layered, cheapest first:

1. **NPPES** — free, no key, authoritative. If the NPI doesn't resolve, or resolves to a
   completely different name, you're done. Already built.
2. **USPS** — is the address deliverable, and is it a PO box or a CMRA (a UPS Store)? A
   practice billing $450 CT scans from a mailbox is the strongest ghost-clinic signal there is.
3. **Google Places** — does a healthcare business exist at those coordinates? `business_status`,
   review count and age. Street View gives you a demo-friendly picture.
4. **Address clustering** — how many distinct NPIs in *your* database share one suite? Ghost
   networks stack shells at a single address. Free, and gets stronger as the DB fills.

**The caveat that keeps you honest:** NPPES addresses are self-reported and CMS does not
revalidate them, so a real practice at a stale address is common and completely innocent.
Address mismatch is deliberately weak evidence in this implementation — it can produce a
`warn`, never a `fail`. Getting this wrong is how a screening tool starts reporting mismatches against real
clinics that are perfectly legitimate.

---

## Try it

```bash
node server.js
```

```bash
# real, active organization
curl -s localhost:3000/api/providers/verify \
  -H 'content-type: application/json' \
  -d '{"npi":"1881018208","providerName":"Mayo Clinic","practiceState":"MN"}' | jq

# fails the federal check digit — caught offline, no network call
curl -s localhost:3000/api/providers/verify \
  -H 'content-type: application/json' \
  -d '{"npi":"1234567890","providerName":"Northside Wellness Group"}' | jq

# well-formed but absent from the registry
curl -s localhost:3000/api/providers/verify \
  -H 'content-type: application/json' \
  -d '{"npi":"1234567893","providerName":"Northside Wellness Group"}' | jq
```

The three together are a good demo arc: a clean provider, a fabricated identifier caught in
microseconds with no network call, and a plausible-looking number that the federal registry
has never heard of.

---

## Placing the call — the Vapi adapter

`main2` had a working outbound-call integration that fired on its own: an analyze request
came in, the claim had a high-severity finding, and the server dialled a phone. That trigger
is not ported. What is ported is the useful part — the Vapi request shape — as a **dispatch
adapter** at `verification/adapters/vapi.js`, behind the approval chain that already exists.

    the ladder decides a call is warranted
      → a named human approves it
        → dispatch(id, { adapter }) places it

Four things had to be decided rather than merged.

**Which axis warrants a call.** `main2` called on the claim axis (`flags[].severity ===
"high"`). This system escalates on the provider axis (`confidenceBand` `incomplete` or
`conflicting`, never on a blocking discrepancy). The provider axis wins, and the reason is
stronger than preference: a call triggered by claim anomalies could not legally discuss the
thing that triggered it. Rule 4 forbids naming the patient, diagnosis, note or amount to a
party we have not verified — which is the entire content of a claim-axis finding. `main2`'s
call existed to ask about procedure codes; this system may not say procedure codes out loud.
The trigger and the sayable content have to match, and on the provider axis they do. This is
not re-checked in the adapter: a tier-1 phone row exists only because `shouldEscalate()`
fired on the provider axis, so it is structural rather than conditional.

**Two switches, both required.** `VAPI_ADAPTER=true` arms the adapter in `server.js`;
`DEMO_AUTO_CALL=true` is checked inside it. With the first off, `dispatch()` is a dry run and
returns the exact payload it would have sent. With the first on and the second off, the
adapter **refuses** — it does not quietly downgrade to a dry run, because a silent downgrade
is how you find out later that you were never testing what you thought you were.

**Who gets called.** `VAPI_TARGET_MODE=demo` (the default) rings `DEMO_BILLING_CONTACT` — one
fixed number, the developer's own phone, synthetic fixture data. `production` dials the
number recorded on the outreach row, which came from `registryContact()` and therefore from
NPPES; it requires a second variable, `VAPI_PRODUCTION_ACKNOWLEDGEMENT`, spelled out in
English, and it refuses any row whose `contact_source` is the practice's own website.

**What gets spoken.** Two script modes. `provider_confirmation` builds its variables from
`draft.providerFacts` — an allowlist of five fields read from the NPPES contact record — so
it has no path to claim content by construction; `assertNoClaimContent()` then re-reads the
rendered result and throws if anything claim-shaped survived. `demo_diagnostic` may carry
claim detail and is permitted only in demo mode. The assistant's first turn discloses that it
is an AI, wired from `composeCallScript().ifAutomated`: several US states require it and the
FCC treats AI-generated voices as artificial under the TCPA.

**Cooldown.** `main2` used an in-memory `Set` keyed by claim number, so a restart re-called
every provider and two claims from one NPI were two calls. `outreach_queue` is persistent and
keyed by NPI; `callsAlreadySentTo()` reads it, and `dispatch()` enforces it for every adapter.

**Auth.** `/api/outreach` requires a token (`verification/auth.js`). With
`OUTREACH_OPERATORS` configured the approver's name comes from the token, so the request body
cannot sign someone else's name to a call.

### Proving it

```bash
node fixtures/nppes-fixture-server.js     # :3101
node fixtures/website-server.js           # :3102
OUTREACH_OPERATORS="tok_alice:Alice Chen" DEMO_BILLING_CONTACT="+15555550123" \
  ALLOW_LOCAL_WEBSITES=true NPPES_BASE_URL=http://localhost:3101/api/ node server.js
DEMO_BILLING_CONTACT="+15555550123" node scripts/prove-vapi.js
```

Seven proofs, 64 checks, offline throughout, exits non-zero on failure: the dry run returns
the payload and places no call; an armed adapter places exactly one, to the demo number; a
blocking discrepancy never queues or dials; two claims from one NPI produce one call;
anonymous approval is refused; dispatching an unapproved item is refused; and the
provider-facing script is asserted against the actual claim's patient label, ICD-10 code, CPT
code and amount — none present.

## What this is not

The footer on your UI is the right posture and the agent prompts enforce it: these are
**screening signals for human review**, not unresolved discrepancies determinations and not coverage decisions.
The prompts explicitly forbid concluding unresolved discrepancies, and treat every failed lookup as `unknown`
rather than as evidence against the provider — because a registry outage is our problem,
not the provider's, and a system that turns downtime into suspicion will eventually accuse
someone real.
