## D3 — Define the live-call demo safely

A real outbound call is still the strongest demo moment, but it must not contact real providers or claim to represent a real health plan or member. The receiving party needs to consent and the system must use only synthetic information.

Recommendation: **A** because it keeps the live end-to-end proof while eliminating real-provider, impersonation, and health-data risk.

A) **Call a consented team member using a disclosed demo script, with prerecorded fallback (recommended)** — Completeness: 10/10. The Vapi assistant states it is a hackathon demo, calls a teammate role-playing a provider office, and receives scripted outcomes; the app also supports replaying a saved webhook fixture if telephony fails. *(human: ~45 min / CC: ~10 min)*

B) **Use a fully prerecorded call/transcript only** — Completeness: 7/10. This is maximally reliable but removes the live voice interaction from the primary path. *(human: ~20 min / CC: ~5 min)*

C) **Call real directory phone numbers using the original script** — Completeness: 2/10. This is unsafe for a demo because it misrepresents the caller and creates consent, recording, and operational risks. *(human: ~1h / CC: ~10 min)*

Net: choose a safe live demo with a fallback, or trade away live interaction for maximum reliability. Reply with **A**, **B**, or **C**.