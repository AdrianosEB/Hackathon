# Claim Evidence Ledger — 18-Hour, Three-Engineer Build Plan

## Summary

Ship one offline-first, synthetic claim-review case that flags four unsupported/contradicted/reused billed lines, shows exact citations, and records an analyst’s `hold`, `clear`, or `escalate` decision.

The conditional live Vapi call remains an hour-10 experiment only. If configuration is absent or a rehearsal fails by hour 12, the demo uses a saved end-of-call fixture through the same backend persistence path.

```text
React evidence ledger
        │  /api
        ▼
FastAPI ──► deterministic rules + fixture data
  │                    │
  ├──► SQLite: decisions, clarification state, webhook receipts
  └──► Vapi only after the hour-10 core gate
```

Use React + TypeScript/Vite, FastAPI + Pydantic, Python’s built-in `sqlite3`, `pytest`, and Vitest/React Testing Library. Do not add an ORM, LLM, queue, auth system, cloud deployment, or arbitrary uploads.

## Locked Product and API Contract

- Seed `CLM-001` totaling `$3,285`:
  - `L1` office visit, `$155`, clear.
  - `L2` brain MRI, `$2,400`, `high / explicit_contradiction`: citation says “No imaging ordered today.”
  - `L3` therapeutic exercise, `$300`, `medium / missing_support`: no service-specific therapy evidence.
  - `L4` ECG, `$240`, `medium / reused_support`: its 42-word interpretation matches `EX-REF-101` through `EX-REF-104`; no unique tracing exists.
  - `L5` venipuncture, `$55`, clear.
  - `L6` remote physiologic monitoring, `$135`, `high / explicit_contradiction`: citation says “No remote data available.”
- Store static claim lines, documents, policy excerpts, and reference-corpus notes in one checked-in JSON fixture. Seed SQLite from it on reset; persist only analyst decisions, clarification requests, and processed call receipts. `Finding` is calculated deterministically from fixture data, never model-generated.
- Normalize reused text by lowercasing, collapsing whitespace, and stripping punctuation. Flag only when the normalized text appears in at least three unrelated reference documents and the fixture declares no unique artifact.
- Return a normalized `CaseResponse` from `GET /api/cases/CLM-001`: case metadata, lines, ordered findings, each finding’s exact citations, stored decision, and optional clarification request.
- Implement:
  - `POST /api/findings/{findingId}/decision` with `{ "decision": "hold" | "clear" | "escalate" }`; invalid values return `422`, unknown finding `404`.
  - `POST /api/findings/F-L4/clarification/draft`; only `F-L4` is supported. Repeated drafts return the same active request.
  - `POST /api/clarifications/{requestId}/approve`; marks the request approved, then dispatches only when all live-demo variables are configured.
  - `POST /api/calls/webhook`; verify `Authorization: Bearer <VAPI_WEBHOOK_TOKEN>` using constant-time comparison, then process `status-update` and `end-of-call-report`.
  - `POST /api/demo/replay-call`; feed the saved Vapi payload to the same `process_vapi_event()` function used by the webhook.
  - `POST /api/demo/reset`; restore fixture-backed state and clear decisions, requests, and webhook receipts.
- The sole dial target is server-side `DEMO_BILLING_CONTACT`; the browser never receives it or submits a phone number. The Vapi assistant must disclose “This is a hackathon demo,” request only the synthetic ECG tracing, and make no fraud or payment decision. Configure Vapi to send `status-update` and `end-of-call-report` events with a bearer credential. [Vapi server authentication](https://docs.vapi.ai/server-url/server-authentication), [server events](https://docs.vapi.ai/server-url/events)

```text
draft → approved → connected → completed
                   └→ failed → Replay fixture → completed

completed result: “No unique ECG tracing available”
suggested next action: escalate
final payment-review decision: still made by the analyst
```

## Engineer Assignments and Handoffs

| Engineer | Owns | Exact deliverable by handoff |
|---|---|---|
| 1 — Rules/API | `backend/app/{schemas,fixture,rules,db,main}.py`, fixture, backend tests | `GET /api/cases/CLM-001`, decisions, reset, and a fixture-result contract that returns exactly `F-L2`, `F-L3`, `F-L4`, `F-L6`. |
| 2 — Frontend | `frontend/**`, API client, UI tests | Evidence-ledger screen driven first by a local contract mock, then the real API. All loading, error, decision, clarification, and reset states visible. |
| 3 — Clarification/integration | `backend/app/{clarifications,telephony}.py`, Vapi fixture, replay/webhook tests, `.env.example`, run instructions | Isolated FastAPI router plus `process_vapi_event()`; no edits to Engineer 1’s rules module. It supports real Vapi only when enabled and always supports replay. |

### Shared first 30 minutes

1. Freeze the fixture IDs, response envelope, decision enum, and status enum in a one-page API contract.
2. Create local `backend/.env` from `.env.example`; do not commit it or expose values in the frontend.
3. Set `ENABLE_LIVE_DEMO_CALLS=false` by default.
4. Engineer 2 copies the agreed `CaseResponse` TypeScript type into its local mock; Engineer 1 is the contract owner.

### Engineer 1 — Rules/API instructions

1. Create the FastAPI scaffold, Pydantic request/response types, fixture loader, SQLite repository, and schema initialization.
2. Implement pure rules functions with no database or HTTP dependencies:
   - `missing_support(line, excerpts)`
   - `explicit_contradiction(line, excerpts)`
   - `reused_support(line, corpus)`
3. Make each finding contain check type, severity, exposure, recommendation, and cited excerpt objects with title, locator, quote, and explanation.
4. Build case retrieval, decision persistence, and reset before any telephony integration.
5. Deliver a working API and `pytest` suite by hour 4; expose the clarification router mount point but let Engineer 3 own its implementation.

### Engineer 2 — Frontend instructions

1. Bootstrap Vite React TypeScript and create a small API client; use no global state library.
2. Build one screen with:
   - claim exposure and “hold for analyst review” framing;
   - ranked finding list, defaulting to the highest-dollar high-severity finding;
   - selected finding’s billed line, deterministic check, exact citations, and exposure;
   - decision buttons with pending, saved, and already-decided states;
   - an `F-L4`-only clarification card;
   - visible API-error, no-findings, citation-unavailable, and reset states.
3. Keep the UI non-accusatory: “evidence gap,” “hold for analyst review,” and “AI-generated documentation risk,” never “fraud” or “deny.”
4. Use the mock contract until Engineer 1’s endpoint is ready, then replace only the client implementation. Do not reshape API data in components.
5. Deliver the core evidence ledger by hour 4 and the complete state UI by hour 7.

### Engineer 3 — Clarification/integration instructions

1. Implement the clarification router and SQLite persistence without modifying rules logic.
2. Add a `VapiClient` adapter that:
   - refuses dispatch unless `ENABLE_LIVE_DEMO_CALLS=true` and all required variables exist;
   - sends only `DEMO_BILLING_CONTACT`;
   - stores Vapi’s call ID on the clarification request;
   - maps status updates to visible progress;
   - maps an end-of-call report to the saved transcript and the suggested `escalate` action.
3. Make webhook handling idempotent: preserve the first processed end-of-call report per Vapi call ID; duplicate reports return the stored state and never create another result.
4. Save a synthetic `end-of-call-report` fixture and have replay call the same event processor as the authenticated webhook.
5. By hour 10, check for `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, `VAPI_WEBHOOK_TOKEN`, and `DEMO_BILLING_CONTACT`. If any are absent, do not troubleshoot during the build: rehearse replay instead.
6. If all values exist, configure the Vapi assistant’s authenticated server URL and make one disclosed test call. Vapi requires an outbound-capable phone number; free Vapi numbers cannot place outbound calls. [Vapi outbound calling](https://docs.vapi.ai/calls/outbound-calling), [phone-number limits](https://docs.vapi.ai/phone-calling)

## Timeline, Integration, and Gates

| Time | Required outcome |
|---|---|
| 0:00–0:30 | Shared contract, fixture table, local environment template, ownership boundaries locked. |
| 0:30–2:00 | Engineer 1 API/rules scaffold; Engineer 2 mocked UI; Engineer 3 replay/webhook adapter scaffold. |
| 2:00–4:00 | First vertical slice: real case endpoint renders in the UI; all four expected findings appear. |
| 4:00–7:00 | Citations, decisions, reset, all UI states, backend and frontend tests. |
| 7:00–9:00 | Offline rehearsal and defect cleanup. The app must work with network disabled. |
| 9:00–10:00 | Merge only tested changes; verify replayed clarification result on the UI. |
| 10:00–12:00 | Conditional Vapi branch. Attempt live call only if all configuration is ready; stop permanently at hour 12 on any rehearsal failure. |
| 12:00–15:00 | Replay fallback hardening, test pass, demo polish, error-state verification. |
| 15:00–18:00 | Three full 90-second rehearsals, reset before each, and fix only demo-blocking defects. |

Use separate workspaces/branches for the three lanes. Engineer 1 lands the API contract first; Engineer 2 rebases from it at hour 4; Engineer 3 ships only its router/adapter and asks Engineer 1 for the small router-mount integration commit. This avoids concurrent edits to `main.py` and the frontend.

## Test Plan and Acceptance Gates

- Backend `pytest`:
  - positive and negative tests for all three rules;
  - case response includes only `F-L2`, `F-L3`, `F-L4`, `F-L6`;
  - invalid/unknown decisions, persisted decisions, and reset;
  - only `F-L4` can create a clarification request;
  - live dispatch disabled/misconfigured produces a visible recoverable result and no outbound request;
  - invalid webhook bearer token is rejected;
  - duplicate end-of-call report is idempotent;
  - replay and authenticated webhook produce identical persisted completion state.
- Frontend Vitest:
  - loading, API failure, no findings, finding selection, citation unavailable;
  - decision saving/saved/already-decided;
  - draft, approved, connected, completed, failed, and replayed clarification states;
  - reset reloads pristine fixture state.
- Manual acceptance:
  1. Reset demo.
  2. Open `CLM-001`; show all four planted findings.
  3. Open the MRI, therapy, ECG, and remote-monitoring citations.
  4. Save an analyst decision.
  5. Draft and approve the ECG clarification.
  6. Run replay; show “no tracing available” and suggested escalation.
  7. Reset and repeat with the network disabled.
  8. Only if configured by hour 10, make the disclosed consented live call; otherwise present replay without apology.

## Assumptions and Explicit Deferrals

- The Vapi branch is conditional, per the selected option B. No credentials are currently present, so replay is the expected baseline.
- No PHI, real providers, arbitrary uploads, payer integrations, automated denials, fraud determinations, claims queue, PDF export, login, cloud deployment, or LLM risk scoring.
- No Batch Sentinel work begins unless all acceptance gates pass before hour 15; in this 18-hour plan, it is effectively deferred.
- Use the working title “Claim Evidence Ledger”; omit direct competitor comparisons until independently verified.
