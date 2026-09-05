## D1 — Reduce the 5-engineer plan for three people?

The current plan has five separate workstreams and 15+ new files. With three engineers, that makes integration—not coding—the main failure risk. It also proposes calling real provider numbers while impersonating a plan representative, which should not be part of a hackathon demo.

Recommendation: **A** because it preserves the compelling live voice-to-evidence moment while making the demo safe and achievable.

A) **Three-person vertical slice (recommended)** — Completeness: 10/10. Use a fixed synthetic provider fixture, a consented team-member/mock “provider office” phone endpoint, one FastAPI/SQLite API, and a dashboard that includes the audit export. Assign: data/API, voice/webhook, frontend/report. This removes real-provider calls, NPPES fetching, and the fourth/fifth integration roles while retaining the complete demo flow. *(human: ~12h / CC: ~1–2h)*

B) **Keep the original five-workstream scope** — Completeness: 5/10. Three people would each own multiple interdependent layers; live integration, test coverage, and demo reliability will be materially weaker. *(human: ~20–30h / CC: ~3–4h)*

C) **Drop live telephony; dashboard + prerecorded transcript only** — Completeness: 7/10. It is the safest fallback, but loses the product’s strongest differentiator: real-time verification. *(human: ~8h / CC: ~1h)*

Net: choose whether the demo optimizes for a reliable, consented live verification flow or breadth at the expense of integration risk.

Reply with **A**, **B**, or **C**.