D2 — Gate the live-call branch on real Vapi prerequisites

Vapi’s current outbound-call flow requires a private API key, a configured assistant, an outbound-capable phone-number ID, and the consented destination. Free Vapi numbers do not support outbound calls, so discovering this at hour 12 would make the live branch impossible; the replay fallback remains safe. [Vapi outbound calling](https://docs.vapi.ai/calls/outbound-calling), [phone-calling limits](https://docs.vapi.ai/phone-calling)

Recommendation: A because it keeps the live-call option real while protecting the core build schedule.

A) Provision and verify Vapi before the timer starts (recommended). Completeness: 10/10. Before hour 0, one teammate confirms `VAPI_API_KEY`, assistant ID, outbound-capable phone-number ID, the Vapi webhook credential, tunnel URL, and consented `DEMO_BILLING_CONTACT`; run one disclosed synthetic test call. Human: ~30–45 min / agent: ~10 min. Downside: requires access and a consenting teammate in advance.

B) Treat Vapi as a conditional hour-10 experiment. Completeness: 7/10. Build the adapter against environment variables and do a live attempt only if all credentials arrive by hour 10; otherwise demonstrate the replay path. Human: ~15 min prework / agent: ~10 min. Downside: “live” may be unavailable through no fault of the app.

C) Make replay the only planned demo path. Completeness: 8/10. Build and rehearse the exact webhook persistence path using the saved fixture, without a Vapi account or outbound number. Human: ~0 min prework / agent: ~5 min. Downside: it supersedes your selected live-call branch.

Net: reply with A, B, or C.