# Claim Integrity

Two questions about a claim, kept separate:

| Axis | Question | Output |
|---|---|---|
| **Claim** | How much of this claim's own content needs a person to look at it? | `reviewPriority` 0–100, `reviewLevel`, `observations` |
| **Provider** | How well does the provider record match the federal registry? | `dataConfidenceScore`, `confidenceBand`, `checks` |

Collapsing them into one number destroys the useful part: a claim with billing observations
from a well-matched provider is a *coding* question; an ordinary claim from a provider we
could not match is a *data* question. Same score, different problems, different people.

Nothing here concludes fraud. Bands describe the state of the evidence, never the character
of a provider.

## Run it locally

```bash
./run-local.sh
```

Then open <http://localhost:3000>. That starts three processes and talks to nothing outside
your machine:

| | |
|---|---|
| `:3000` | the app |
| `:3101` | fixture federal registry, NPPES-shaped |
| `:3102` | fixture practice websites |

Every fixture NPI starts with `9` — a range CMS has never assigned — so no real provider can
be implicated. Pick a scenario from the dropdown and press **Assess claim**.

The **outreach queue** panel is where the ladder ends. Use operator token `tok_alice`. On
these fixtures the provider panel usually resolves the record, so the queue is normally empty
and correctly so; **Draft an approach** exercises the rest of the chain by treating our own
verification as not having completed — the documented "registry outage on our side" path,
which the queued row records as its reason.

Approve, then dispatch. Dispatch is a **dry run**: it prints the exact Vapi payload it would
have sent and places no call.

## The test bench

<http://localhost:3000/test> runs one subject through the real pipeline and prints **every
stage separately** — what ran, how long it took, and its raw output. Deterministic stages are
marked `D`, the agent stage `A`, so the seam is visible rather than implied: the deterministic
work totals ~0 ms, the agent stage 15–20 s.

Three buttons:

| | |
|---|---|
| **Claim** | Invented provider, fixture registry. Trips three deterministic rules. |
| **Appeal** | A denied claim resubmitted with an argument. Adds a stage — filing window, appealed amount against billed, documentation, denial reason. |
| **Company** | **No fixtures.** Looks a real company up in SEC EDGAR and fetches its real public website. |

Leave *clear the provider cache first* ticked, or the agent stage is a cache hit and costs
nothing — which hides the thing the page exists to show.

### The company track

Same orchestration, different registry. [SEC EDGAR](https://www.sec.gov/edgar) is the closest
structural analogue to NPPES that exists — CIK for NPI, legal name, former names, business
address, SIC for taxonomy — and it satisfies the same scope rule in
[verification/registry.js](verification/registry.js): US federal, public domain, published so
entities can be verified against it. No Google, no open web search, and the company's own site
is read for corroboration only.

Five subjects, including two controls that must **not** be flagged:

- **GitLab** — everything agrees.
- **MongoDB** — incorporated in Delaware, headquartered in New York. The most common
  arrangement in US corporate law, and it must not read as a discrepancy.
- **Wrong owner** — a real, active CIK with the wrong company name. Comes back blocking.
- **Absent** — well-formed, never issued.
- **Malformed** — rejected offline, before any network call.

EDGAR's fair-access policy requires a real contact address in the User-Agent:

```bash
SEC_CONTACT_EMAIL=you@example.com ./run-local.sh
```

## Proving the call path

```bash
node scripts/prove-vapi.js
```

7 proofs, 64 checks, offline, exits non-zero on failure. See the Vapi section of
[VERIFICATION.md](VERIFICATION.md).

## Making a phone actually ring

Two switches, both required — `VAPI_ADAPTER=true` and `DEMO_AUTO_CALL=true` — and even then
`VAPI_TARGET_MODE` defaults to `demo`, which rings `DEMO_BILLING_CONTACT` and never a
practice. See [.env.example](.env.example).

## Docs

- [VERIFICATION.md](VERIFICATION.md) — architecture, vocabulary, the Vapi adapter
- [DEMO.md](DEMO.md) — demo script and switches
- [verification/outreach.js](verification/outreach.js) — the four outreach rules, in the header
