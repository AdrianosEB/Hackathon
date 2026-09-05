## D7 — Make API failures visible instead of silently serving mock data

The current API sketch accepts an untyped request body, and the frontend returns mock results for any failed request. During integration, a bad payload, 404, CORS issue, or server failure could look like a healthy demo with stale fake data.

Recommendation: **A** because explicit contracts are a small cost and make failures diagnosable rather than misleading.

A) **Typed API contracts and explicit UI states (recommended)** — Completeness: 10/10. Use Pydantic request/response models and stable error payloads; mock data is allowed only behind an explicit development flag; render loading, empty, error, queued, and completed states in the UI. *(human: ~1h / CC: ~10 min)*

B) **Keep generic bodies and catch-all mock fallback** — Completeness: 4/10. It is fastest initially, but masks broken integration and leaves the demo state ambiguous. *(human: ~10 min / CC: ~2 min)*

C) **Remove mocks without adding typed contracts** — Completeness: 7/10. This reveals failures honestly but still gives engineers weak validation and inconsistent client errors. *(human: ~20 min / CC: ~5 min)*

Net: this trades a small amount of scaffolding for truthful UI behavior and a clear handoff between all three engineers. Reply with **A**, **B**, or **C**.