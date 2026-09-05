## D4 — Harden the call-result boundary

The original webhook handles only one end-of-call payload and trusts it implicitly. If Vapi retries, sends an intermediate status, or the public tunnel receives unrelated traffic, the dashboard can show the wrong state or none at all. The live call and prerecorded fallback should produce the same persisted result.

Recommendation: **A** because it is a small, explicit boundary that makes the demo recoverable and avoids exposing the Vapi key to the frontend.

A) **Authenticated, idempotent backend adapter (recommended)** — Completeness: 10/10. `POST /calls/trigger` creates a `queued` call record; the webhook verifies a configured secret, accepts status/end-of-call events, and idempotently upserts by Vapi call ID. The UI polls the API; a development-only fixture replay uses the same persistence path. *(human: ~1–1.5h / CC: ~15 min)*

B) **Keep one unauthenticated end-of-call handler** — Completeness: 5/10. It is faster to write, but transient states, retries, and malformed or unrelated requests can leave the dashboard wrong or stuck. *(human: ~30 min / CC: ~5 min)*

C) **Call Vapi directly from the React app** — Completeness: 2/10. It removes backend work but exposes credentials and makes reliable webhook-to-provider association harder. *(human: ~20 min / CC: ~5 min)*

Net: a modest backend adapter buys deterministic state, safe credentials, and one recovery path for both live and replayed calls. Reply with **A**, **B**, or **C**.