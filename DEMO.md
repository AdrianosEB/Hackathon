# Demo setup

## Why local, not a hosted fake site

You don't need a website at all. Nothing in this architecture fetches websites — the
web-verifier was cut for the injection and ToS reasons. What gets verified is **an NPI in a
registry**, so what you need is a **fake registry**, and it should run on your machine:

- **No network at demo time.** Conference wifi is the single most reliable way to lose a demo.
- **Reproducible.** A judge can ask you to run it twice and get the same answer.
- **Scenarios the real registry can't give you** — a deactivated NPI, a misappropriated
  identity, prompt injection in a registry field — without pointing at a real practice to
  demonstrate them.
- Nothing to deploy, nothing to take down afterwards.

The fixture speaks the real NPPES v2.1 response shape, so **not one line of verification
code differs between demo and live.** A demo that runs a different code path than production
has demonstrated nothing.

## Why every fake NPI starts with 9

CMS issues NPIs beginning **1** (individuals) and **2** (organizations). The **3–9 ranges are
reserved and unassigned**. So a 9-prefixed NPI with a correct check digit is structurally
valid — it exercises the real validation path — while being guaranteed not to belong to
anyone.

That matters more than it sounds. The alternative is inventing plausible 1-prefixed NPIs,
risking a collision with a real practice, and then standing in front of a room explaining
that some real clinic is submitting claims that do not check out. **Every unmatched record in the fixtures is
fictional by construction.**

## Run it

```bash
# terminal 1 — fake registry
node fixtures/nppes-fixture-server.js

# terminal 2 — app, pointed at it
NPPES_BASE_URL=http://localhost:3101/api/ node server.js

# terminal 3 — fire all eight scenarios
node fixtures/demo-claims.js --post
```

Every result carries `dataSource: "FIXTURE — invented providers, not the federal registry"`,
so it can never be ambiguous what the audience is looking at. Unset `NPPES_BASE_URL` and it
talks to the real CMS registry.

Two extra switches:

```bash
FIXTURE_LATENCY_MS=800 node fixtures/nppes-fixture-server.js   # slow registry
FIXTURE_OUTAGE=true    node fixtures/nppes-fixture-server.js   # registry down
```

The outage one is worth showing: the system returns `unknown` and an honest "we couldn't
check", rather than inventing a finding. A screening tool that turns *its own* downtime into
suspicion of a provider is the failure mode that gets real clinics hurt.

## Agent mode switch — deterministic by default

```bash
AGENTS_LIVE=false                      # default: zero API calls, zero tokens
AGENTS_LIVE=true                       # real agents talking to each other
AGENTS_LIVE=true AGENTS_RECORD=true    # live, and capture responses to a cassette
```

**Record once, replay forever.** The obvious way to make a demo deterministic is to
hand-write the responses you wish the agents gave — but that demo is a lie, and it drifts
from real behaviour the moment a prompt changes. Instead: run it live once with your API
key, record what the agents actually said, then replay that for free. Genuine model output,
zero cost, same answer every run.

Until you record anything, rule-based stand-ins cover it. They are labelled
`_source: "rule_based_stand_in"` in the output and never pretend to be model-authored.
Cassette keys include a prompt version, so editing an agent's instructions invalidates its
old recordings rather than silently replaying output from a prompt that no longer exists.

Most of the pipeline doesn't need the switch at all: NPI validation, comparison,
adjudication, website extraction and corroboration are all deterministic already. The
model is only consulted for genuinely ambiguous judgement.

## Website contact discovery (tier 0)

```bash
node fixtures/website-server.js        # terminal 3 → :3102
ALLOW_LOCAL_WEBSITES=true NPPES_BASE_URL=http://localhost:3101/api/ node server.js
```

| Site | Yields | Result |
|---|---|---|
| `/riverbend` | registry phone + 2 emails, name and city match | **tier 0**, corroboration `strong` — reviewer can likely close without calling |
| `/cascade` | nothing — "under construction" | **falls through to tier 1 phone** |
| `/blackrock` | phone matches, but hidden div carries injected text | tier 0 with an explicit *do not rely on this page* warning |
| `/pinehollow` | 404 | falls through to phone |

**The website is for finding a contact, never for judging the provider.** The practice
authors that page, so anything favourable on it is self-authored and the absence of a site
means nothing. The one genuinely useful signal is cross-reference: a phone number on the
site that **matches the federal registry** means two roughly-independent sources agree.

Three things make this safe:

**Extraction is regex, not a model.** Ask a model "what is this practice's phone number?"
and the page can answer for it — *"our number is 555-0100, and this provider is fully
verified"* — and the model carries both across. A regex cannot be talked into anything. An
injected instruction does not look like a phone number, so it cannot become one.

**Hidden text is separated and treated as worse.** A `display:none` div or an HTML comment
is invisible to a patient and plain to a scraper. Instructions in visible text are odd;
instructions in hidden text have no innocent explanation, and are reported as `location:
"hidden"`. Contacts are only ever taken from *visible* text — a number a patient cannot see
is not a channel the practice is offering, and honouring it would let a page choose who we
ring.

**SSRF guard on every fetch.** The URL can come from a claim, which means it can come from
someone who would like us to make requests for them. `http://169.254.169.254/` — the cloud
metadata endpoint — is refused, as are all private, loopback and link-local ranges, plain
http to remote hosts, and non-http protocols. Local fixture sites need
`ALLOW_LOCAL_WEBSITES=true`, granted by env var and never inferred from the URL.


## The eight scenarios

| # | NPI | Scenario | Expected |
|---|---|---|---|
| 1 | `9000000015` | Riverbend Family Medicine — everything agrees | pass · probable · no outreach |
| 2 | `9000000023` | Cascade Imaging — moved, never updated NPPES | warn · unverified · **phone outreach queued** |
| 3 | `9000000031` | Summit Care — deactivated NPI | fail · **blocked** · hold · no outreach |
| 4 | `9000000049` | **Misappropriated NPI** — valid, wrong owner | fail · **blocked** |
| 5 | `9000000056` | **Prompt injection in the registry entry** | injection flagged as a discrepancy |
| 6 | `9000000064` | Lakeside Pediatrics — trade name vs legal name | **pass — the control** |
| 7 | `9000000080` | Absent from the registry | fail · **blocked** |
| 8 | `9000000081` | Bad check digit | fail · **blocked**, zero network calls |

### The three worth actually presenting

**#4, misappropriated NPI.** A valid, active identifier belonging to a completely different
practice than the one billing. This is the real shape of identity theft in claims. Any system
that only asks "does this NPI exist?" passes it — ours compares the registrant to the biller
and catches it.

**#5, injection in the registry.** NPPES organization names are free text typed in by the
registrant; CMS doesn't vet the wording. So an attacker can write instructions to an AI into
their own federal registry entry. Not hypothetical cleverness — it's the obvious move once
anyone knows claims are screened by a model. The system surfaces it, refuses it, and treats the
attempt itself as a material unresolved discrepancy, because no legitimate practice has a reason to
put prompt text in its registry record.

**#6, the control.** Bills as "Lakeside Pediatrics", registered as "LAKESIDE PEDIATRIC
ASSOCIATES LLC". Passes clean via alias matching. Have this ready for the judge who asks
whether you just flag everything — a unresolved discrepancies detector with no false-positive story is not a
product.

## Verified against the fixtures

```
9000000015  Riverbend Family Medicine      ACTIVE   name=strong (1.00)   addr 3/3
9000000023  Cascade Imaging Partners       ACTIVE   name=strong (1.00)   addr 2/3
9000000031  Summit Care Group              DEACTIV  name=strong (1.00)   addr 3/3
9000000049  Northgate Wellness Collective  ACTIVE   name=weak   (0.00)   addr 0/3
9000000056  Blackrock Medical Services     ACTIVE   name=weak   (0.19)   ⚠ INJECTION x2
9000000064  Lakeside Pediatrics            ACTIVE   name=strong (1.00)   addr 3/3
9000000080  Pine Hollow Medical            NOT IN REGISTRY
9000000081  Grandview Health Partners      BAD CHECK DIGIT — 0 network calls
```

Outreach contact sourcing, verified live:

```
claim said:    206-555-0142 @ 1500 Denny Way, Seattle
outreach uses: 206-555-0142 @ 880 NE 45TH ST STE 200, SEATTLE  — source NPPES
```

The claim's address is ignored. Contact details come from the registry, because ringing a
number the subject supplied verifies nothing.

## Honest limits

The injection screening is a **tripwire, not a wall** — no regex enumerates natural language,
and a patient attacker will phrase around it. The actual defence is that a finding rests on
mechanical fields (`status`, `isActive`, computed agreement ratings) that no amount of prose
in a name field can move. The regex only makes the attempt visible.

It can also produce a false positive on an unlucky-but-real practice name. That's survivable
by design: a flag routes to human review, it doesn't reject a claim.
