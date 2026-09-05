# Ghost Network — Three-Engineer Hackathon MVP

## Summary

Build one reliable vertical slice: synthetic provider discrepancies → disclosed live demo call to a consented teammate → authenticated webhook/classification → dashboard and printable evidence record.

Do not fetch live NPPES data, call real providers, use real member data, or claim CMS compliance.

## Key Changes

- Use a checked-in fixture of 20 synthetic providers with 8 planted discrepancies across phone, specialty, address, and inactive-provider cases. Seed SQLite on startup.
- Keep FastAPI + SQLite + React, but eliminate the standalone audit HTML app. Add a printable dashboard route/component, titled **“Network Verification Record — Demo”**, using the same API data.
- Define typed API models and explicit UI states. `POST /calls/trigger` accepts only `provider_id`; the backend supplies fixed synthetic demo-plan/member context. Return typed validation and failure responses; mocks are permitted only behind an explicit development flag.
- Persist call state as `queued`, `in_progress`, `completed`, or `failed`, with nullable classification. Create the record before dispatch; process Vapi events through an authenticated webhook, verify its configured secret, and idempotently upsert by Vapi call ID.
- Send all outbound calls only to `DEMO_DESTINATION_NUMBER`, owned by a consenting teammate. The assistant opens with a disclosure that this is a hackathon demo; it never contacts directory phone numbers or impersonates a real plan/member.
- Store the raw transcript, supporting excerpt, classifier result, confidence, and demo scenario. If the classifier fails or the transcript is inconclusive, return `NO_ANSWER`/low confidence rather than asserting a positive outcome.
- Include a saved Vapi end-of-call webhook fixture and a local replay command that exercises the exact production persistence/classification path. This is the primary demo fallback.

## Ownership and Integration

| Engineer | Owns | Handoff |
|---|---|---|
| 1 — Data/API | Fixture, Pydantic models, SQLite, provider/stats/trigger endpoints | Stable typed API by hour 3 |
| 2 — Voice | Vapi adapter, consented script, webhook auth/idempotency, classifier, replay fixture | End-to-end call result by hour 4 |
| 3 — UI | Dashboard, explicit state handling, printable verification record, polling | UI wired to typed API by hour 4 |

- First 30 minutes: jointly lock the fixture schema, API responses, `DEMO_DESTINATION_NUMBER`, Vapi credentials, and webhook secret.
- Hours 0.5–3: work in parallel by owned module; Engineer 3 uses a controlled development fixture only until the API handoff.
- Hours 3–5: integrate API/UI and run fixture replay.
- Hours 5–7: make one consented live call; if it fails, use replay for the demo and fix only if time permits.
- Hours 7–12: polish the evidence record, rehearse, and keep the fallback ready.

## Test Plan

```text
fixture → discrepancy validation → SQLite → /providers,/stats → dashboard
trigger → queued call → Vapi → authenticated webhook → classify → completed → UI/report
saved webhook fixture ──────────────────────────────────────────────────┘
```

- `pytest`: fixture schema and scores; provider-not-found validation; queued-call creation; webhook-secret rejection; duplicate webhook idempotency; classifier success, malformed transcript, and fallback behavior.
- `Vitest`: loading, empty, API-error, queued, completed, and failed call states; provider detail; printable evidence record.
- One integration smoke test replays the saved webhook fixture through FastAPI and verifies the resulting dashboard/report data.
- One manual consented Vapi call verifies dispatch, webhook arrival, and visible state transition. Real telephony is never required for the fallback path.

## Assumptions and Boundaries

- Vapi’s server URL is configured with an authentication credential, and the local tunnel is checked before the live-call attempt; use a model name configurable by environment rather than hard-coding it. [Vapi server authentication](https://docs.vapi.ai/server-url/server-authentication)
- The project is a local, single-user hackathon demo; no production deployment, login, cloud infrastructure, maps, multi-insurer support, licensing-board ingestion, or regulatory certification.
- The printed record is proposed evidence-chain UX over synthetic data, not a legal or regulatory filing.
- No unresolved decisions.
