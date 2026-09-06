# Prompt for Claude Code

Paste everything below the line into Claude Code, run from the repo root.

---

## Task

This repo has two halves that have never met.

**Branch `main2`** has a working outbound voice-call integration (Vapi) that fires
automatically when a claim looks bad.

**Branch `main`** (the working tree you're in) has a provider-verification agent
orchestration with a four-tier outreach ladder — website → phone → email → human — that
drafts calls but deliberately never places them.

Merge them so that Vapi becomes the thing that actually places the call at the end of the
ladder. Do not simply copy `main2`'s trigger across: it conflicts with the outreach layer in
four specific ways, listed below, and each one needs a deliberate decision rather than a
silent overwrite.

## Step 1 — Read the existing call rules

```bash
git fetch origin main2
git show origin/main2:vapi.js > /tmp/main2-vapi.js
git show origin/main2:server.js > /tmp/main2-server.js
git show origin/main2:ai-reviewer.js > /tmp/main2-ai-reviewer.js
git show origin/main2:.env.example > /tmp/main2-env.example
```

Read all four. Confirm for yourself what the call conditions actually are before writing
anything — do not trust my summary below, verify it.

What I believe you'll find, in `vapi.js::triggerVapiClarification` and around lines
600–660 of `main2`'s `server.js`, is that a call fires when **all** of:

1. `process.env.DEMO_AUTO_CALL === "true"`
2. All of `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`,
   `DEMO_BILLING_CONTACT` are set
3. `analysis.flags.some(f => f.severity === "high")` — at least one high-severity finding
4. The claim number is not already in the in-memory `autoCalledClaims` Set

It then POSTs to `https://api.vapi.ai/call` with `assistantId`, `phoneNumberId`,
`metadata.claimNumber`, `customer.number = DEMO_BILLING_CONTACT`, and
`assistantOverrides.variableValues = { claimNumber, providerName, findings }`, where
`findings` is a newline-joined summary of the high-severity findings including procedure
codes and evidence text.

## Step 2 — Understand what's already here

Read these before changing anything:

- `verification/outreach.js` — the ladder. Read the four rules in the file header; they are
  load-bearing and the reasoning is in the comments.
- `verification/index.js` — `escalate()`, `triage()`, and the exported queue functions.
- `analyzer.js` — note the output shape and the vocabulary note at the top.
- `VERIFICATION.md` — architecture and the vocabulary table.

## Step 3 — Resolve these four conflicts

### 1. Autonomy

`main2` dials on its own. The outreach layer requires a named human to approve every call
(`approveOutreach(id, approvedBy)` rejects anonymous approval), and `dispatch()` refuses
anything not in `approved` status.

**Resolve this way:** Vapi becomes a **dispatch adapter**, not an independent trigger. The
ladder still decides *whether* a call is warranted and drafts it; a human still approves;
`dispatch(id, { adapter: vapiAdapter })` is what finally places it. Delete the autonomous
trigger path rather than leaving both wired.

Write the adapter at `verification/adapters/vapi.js` matching the signature `dispatch()`
already expects: `async (outreachRow) => result`.

Keep `DEMO_AUTO_CALL` as a second, independent kill switch — an adapter that is present but
disabled should refuse, so there are two things that must both be true before a phone rings.

### 2. Schema mismatch

`main2` reads `analysis.flags[].severity === "high"`. This branch renamed that axis:
`analysis.observations[].weight` and `analysis.reviewLevel` (`routine` / `review` /
`priority`). See the vocabulary table in `VERIFICATION.md`.

Do **not** just rename fields to make it compile. The two systems disagree about *which
axis should trigger a call*, and that's a real design question:

- `main2` calls on **claim content** being anomalous.
- This branch escalates on **provider record** being unmatched (`incomplete` /
  `conflicting`), and explicitly never on a blocking discrepancy.

Those are different questions. Decide which one warrants a phone call, write the reason in a
comment, and make the code say what you decided. My view: the provider axis is the one worth
calling about — an anomalous claim from a well-matched provider is a coding question you
resolve in the record, not on the phone — but argue with me in the code if you disagree.

### 3. Who gets called

`main2` calls `DEMO_BILLING_CONTACT`, a single fixed number.

**Keep that as the demo default.** It's the safest possible arrangement: it rings the
developer's own phone with synthetic data, and no real practice is ever disturbed.

The production path is the number from `registryContact()` in
`verification/sources/nppes.js` — the federal registry's number, never the one printed on
the claim. The header of `outreach.js` explains why at length; the short version is that the
claim was submitted by the party being checked, so ringing its number asks a suspect to
vouch for themselves on a line they chose.

Make the demo/production distinction explicit and loud in the code. A future reader must not
be able to flip it on by accident.

### 4. What gets spoken aloud

`main2` builds `findingsText` from procedure codes and evidence, and a voice assistant reads
it to whoever answers.

Rule 4 in `outreach.js` is that outreach confirms **provider details only** — never the
patient, diagnosis, clinical note, or billed amount. You are speaking to a party you have
not verified.

That rule can relax for the demo *only because* the call goes to `DEMO_BILLING_CONTACT` with
synthetic data. Implement two script modes, and make the provider-facing one incapable of
including claim content — not by convention, but structurally, so it can't regress.

Also: **the assistant must disclose that it is an AI at the top of the call.** Several US
states require it, and the FCC treats AI-generated voices as artificial under the TCPA.
`composeCallScript()` already returns an `ifAutomated` field saying so — wire it into the
Vapi assistant's first turn.

## Step 4 — Also fix

- `autoCalledClaims` is an in-memory `Set`, so a server restart re-calls every claim. The
  `outreach_queue` table is already persistent and enforces a 14-day per-provider cooldown.
  Use it and drop the Set.
- There is **no auth on the outreach endpoints**. `POST /api/outreach/:id/approve` takes
  `approvedBy` as a free string, so anyone who can reach the server can approve a call and
  type someone else's name into the audit trail. This is now the weakest link in a chain the
  whole design rests on, and it's guarding something that dials real phones. Add a minimal
  shared-secret or session check.
- Delete `verification/research.js` — dead, unimported.

## Step 5 — Prove it

Do not tell me it works. Show me:

1. `AGENTS_LIVE=false` and no Vapi keys → `dispatch()` is a dry run, returns the exact
   payload that *would* have been sent, places no call.
2. An approved tier-1 phone item with a configured adapter → one call, to
   `DEMO_BILLING_CONTACT`.
3. A blocking discrepancy (fixture NPI `9000000031`, deactivated) → **no call at any
   point**, routed to `provider_data_review`.
4. Two claims from the same NPI in one session → **one** call, cooldown holds.
5. Anonymous approval → refused.
6. Dispatch of an unapproved item → refused.
7. The provider-facing script, asserted against actual claim values (patient label,
   ICD-10, CPT codes, amount) → none present.

Run the fixtures offline the whole time:

```bash
node fixtures/nppes-fixture-server.js     # :3101
node fixtures/website-server.js           # :3102
ALLOW_LOCAL_WEBSITES=true NPPES_BASE_URL=http://localhost:3101/api/ node server.js
node fixtures/demo-claims.js --post
```

## Constraints

- Every fixture NPI starts with `9` — a range CMS has never assigned — so no real provider
  can be implicated. Keep it that way.
- No new data sources without checking `verification/registry.js`, which documents what was
  deliberately excluded and why (Google Maps ToS, fetching provider-authored pages, open web
  search on a practice name).
- The vocabulary rules in `VERIFICATION.md` apply to anything the voice assistant says. It
  is confirming records, not accusing anyone. The words fraud, suspect, fake, and their
  synonyms do not appear.
- If you find that my summary of `main2`'s rules in Step 1 is wrong, trust the code and tell
  me what I got wrong.
