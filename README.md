# Claim Integrity

Synthetic medical-billing review demo. A claim is screened by deterministic
rules and an AI evidence reviewer, a voice agent calls the provider about
anything routed to a human, and the provider's appeal is judged against the
original findings.

Nothing here determines fraud, approves or denies a claim, or makes a medical
or payment decision. It decides which claims a human looks at, and in what
order.

## Run it

```bash
npm install
cp .env.example .env      # then fill in what you have
npm start                 # http://localhost:3000
```

The app runs with an empty `.env`. Every credential is optional:

| Missing | What still works |
|---|---|
| `OPENAI_API_KEY` | Everything, decided by the deterministic rules alone. Claims and appeals both show `AI: UNAVAILABLE`. |
| Vapi credentials | Everything except the outbound call. Claims are still analyzed, saved and routed to a human. |

The boot log tells you which mode you are in, and with `DEMO_AUTO_CALL=true`
names any Vapi variable that is missing.

## Demo script

Import claims from `demo/` and appeals from `demo_appeal/` through the website.
Each filename says what it is meant to do:

- `claim_01_clean.csv` → low, no call
- `claim_06_high_duplicate.csv` → high, call placed
- `appeal_06_WORKS_duplicate_removed.txt` → resolved
- `appeal_07_PARTIAL_...txt` → partially resolved
- `appeal_09_FAIL_...txt` → not resolved

`npm run example:demo` checks all 18 of those still do what their names say.

## Examples

None of these touch the database, start a server, or place a call.

```bash
npm run example        # every scenario, all three stages
npm run example:demo   # the shipped demo/ and demo_appeal/ files
npm run example:call   # the call lifecycle against a fake Vapi queue
npm run example:merge  # how rules findings and AI findings combine
```

## Layout

```
analyzer.js              deterministic claim rules
ai-reviewer.js           AI claim evidence review
appeal-analyzer.js       deterministic appeal re-check
appeal-ai-reviewer.js    AI appeal evidence review
vapi.js                  outbound call, queue, polling
db.js                    SQLite storage
server.js                HTTP API
orchestration/           the three stages; see orchestration/README.md
examples/                runnable examples
website/                 the frontend
```
