# GroundTruth

> *Working name — swap in your own.*

**Continuous, evidence-backed verification that every billing provider is real — before the money goes out.**

---

## 1. One-Line Pitch

Medicare and Medicaid verify a provider once at enrollment, then never check again. GroundTruth continuously re-verifies every billing entity against public federal and state records, scores claims against peer billing patterns, and hands program integrity teams an audit-ready evidence dossier — turning "pay and chase" into prevention.

**Alternate (10-second version):** *Credentialing is a photograph. Fraud is a movie. We watch the movie.*

---

## 2. The Problem

### 2.1 The money

FY2025 federal improper payments (CMS):

| Program | Rate | Dollars |
|---|---|---|
| Medicaid | 6.12% | $37.4B |
| Medicare FFS | 6.55% | $28.8B |
| Medicare Part C | 6.09% | $23.7B |
| Medicare Part D | 4.00% | $4.2B |
| **Total** | | **~$94B** |

**Honest deflator:** 77% of Medicaid improper payments were *insufficient documentation*, not fraud or overbilling. The portion addressable by detecting phantom entities and billing anomalies is closer to **$20–25B/year**. We use the smaller number. Anyone who pitches $94B as their TAM has not read the footnotes.

### 2.2 Why the current system fails

Enforcement is **post-payment**. Medicare is required to pay clean claims quickly, so money leaves before review. The industry calls this "pay and chase," and the chase does not work:

- DOJ's 2025 National Health Care Fraud Takedown — the largest in US history — charged 324 defendants across 50 federal districts over **$14.6B** in intended losses.
- Total assets recovered: **~$245M**.
- That is roughly **1.7 cents on the dollar.**

### 2.3 The specific gap we attack

Three real cases, one shared root cause:

**Operation Gold Rush** — $10.6B billed to Medicare for urinary catheters. The perpetrators did not fake credentialing. They **purchased existing DME companies that already held Medicare billing privileges.** Point-in-time credentialing is structurally blind to this.

**LA County hospice fraud** — CMS estimates ~$3.5B from a single county. The structural signature: multiple shell companies operating from a **single physical address**, under different names and licenses, each billing few enough patients to stay below detection thresholds.

**Ghost networks** — CMS's own review found 48.7% of Medicare Advantage provider directory locations contained at least one inaccuracy, with individual plans ranging from 9.6% to 97.2%. Plans are paid for network adequacy they do not deliver.

**Root cause in all three:** nobody continuously verifies that a billing entity is physically real, currently active, and under the same ownership it was credentialed under.

### 2.4 Evidence that CMS lacks a tool for this

CMS's response to hospice and home health fraud was a **blanket six-month nationwide enrollment moratorium** on new agencies. That is a sledgehammer. You reach for one when you do not have a scalpel. GAO also published a 2026 report specifically examining gaps in CMS's fraud analytics (GAO-26-107799).

---

## 3. The Solution

### 3.1 Product modules

**Module 1 — Entity Verification Engine (core)**

Continuous re-verification of every billing NPI against public sources:

| Signal | Source | Catches |
|---|---|---|
| NPI status / deactivation | NPPES bulk + API | Dead, retired, revoked |
| License status | 50 state boards | Expired, suspended, revoked |
| Federal exclusion | OIG LEIE | Barred providers still billing |
| Taxonomy mismatch | NPPES vs. claim/listing | Specialty misrepresentation |
| Address validity | USPS | Mailbox stores, residences, non-clinical sites |
| **Address clustering** | Derived | **Shell company farms (the hospice signature)** |
| Business status | Google Places | Permanently closed |
| Web presence | Practice site | Nonexistent or dormant operations |
| Line status | Carrier lookup | Disconnected numbers |
| Ownership change | PECOS / state filings | **The Gold Rush pattern** |

Agent orchestration is required because ~50 state license boards have no common API and no common schema. This heterogeneity is the technical moat, not the individual lookups.

**Module 2 — Claim Anomaly Scoring**

Peer-relative statistical scoring using the public CMS Medicare Physician & Other Practitioners dataset (100% of final-action Part B claims, by NPI × HCPCS × place of service) to build specialty baselines. Flags:

- E/M code distribution skew (upcoding)
- Unbundling and modifier-25/59 abuse patterns
- Impossible service volume (>24 billable hours/day)
- Diagnosis–procedure necessity mismatch
- Volume anomalies against same-specialty, same-geography peers

**Module 3 — Evidence Dossier**

Per-entity audit packet: timestamped source snapshots, which signals fired, confidence score with decomposition, and chain of custody. Built to be usable in a program integrity action, an AG investigation, or a payment suspension — not just a dashboard.

### 3.2 Explicitly out of scope: appeals

Appeals are filed by providers and patients **against** payers. Our customer is the payer and the government. Building appeals tooling would arm the opposing side of our customer's fight. Excluded by design, not by omission.

### 3.3 Scoring methodology

Log-odds / weight-of-evidence, not a black-box model:

- **Explainable** — every score decomposes into named contributing signals (required for audit defensibility)
- **No training data needed** — no labeled fraud corpus required to launch
- **Correlated-signal handling** — signals grouped into evidence families (identity / location / activity / ownership); strongest signal per family, not naive summation, to prevent overconfidence when one underlying fact triggers several signals

**Three-state output, never two:** `VERIFIED` / `CONTRADICTED` / `UNVERIFIABLE`. Unverifiable is never folded into contradicted. Reported findings lead with the conservative floor.

**Free calibration labels:** NPPES deactivation file provides known-negatives; recent Medicare billing activity in the CMS Doctors & Clinicians dataset provides known-positives. This yields a real ROC curve and calibration plot with zero human labeling.

---

## 4. Market Sizing

### 4.1 TAM

**Market-spend basis (what buyers pay vendors today):**

| Segment | 2026 | Forecast | CAGR |
|---|---|---|---|
| Healthcare payment integrity (total) | $17.1B | $31.3B by 2031 | 12.9% |
| — FWA detection sub-segment | ~$3.2B | ~$7.9B by 2031 | 19.5% |
| Provider data management | ~$3.7B | ~$8.4B by 2033 | 13.5% |

We straddle FWA detection and provider data verification: **~$7B TAM (2026).**

**Value-at-stake basis:** ~$20–25B/year in annually recurring addressable leakage (after the documentation deflator in §2.1).

> Market research estimates for these segments diverge meaningfully between firms depending on category definitions. Ranges shown are directional.

### 4.2 SAM

Government-sponsored programs, US only, FWA + provider verification slice. Government programs represent roughly half of US health expenditure.

**SAM ≈ $3–3.5B**

Addressable buyer universe:

| Buyer type | Count |
|---|---|
| State Medicaid agencies | 51 |
| Medicare Administrative Contractors | ~12 |
| MA / MA-PD plans (2026) | 3,795 (down from 4,186 in 2025) |
| Medicaid MCOs | Several hundred |

Note the consolidation trend: fewer logos, larger contracts, higher barrier to entry.

### 4.3 SOM

**Realistic 3-year target: $1–5M ARR.**

Entry path is explicitly *not* the top-10 payers:

1. **State Medicaid program integrity contracts** — RFP-driven, slow, but winnable by a specialist against generalist incumbents
2. **Regional Medicaid MCOs and smaller MA plans** — underserved by incumbents whose economics favor large accounts
3. **State AG offices and oversight bodies** — episodic but high-visibility; the ghost network precedent (NY AG settlements with EmblemHealth at $2.5M and MVP Health Plan) proves budget exists

**Bottom-up:** 3–5 mid-size plan contracts at $250K–$1M ARR, or 2–3 state contracts, reaches the range.

---

## 5. Business Model

**Primary: contingency fee on validated savings.** This is the industry norm and the reason incumbents publish *savings delivered* rather than revenue — Gainwell reports ~$11B, Cotiviti $10B+, Optum $8B+.

- **Pro:** removes budget-approval friction; aligns with how program integrity offices are measured
- **Con:** revenue lags delivery; requires working capital

**Secondary: SaaS subscription** for continuous monitoring (per-NPI-per-year), which smooths revenue and suits directory-compliance buyers.

**Adjacent revenue — the REAL Health Providers Act.** Signed **February 3, 2026**. From plan year 2028, Medicare Advantage organizations must verify provider data every 90 days, flag unverified records publicly, remove departed providers within 5 business days, conduct **annual statistical accuracy audits**, publish accuracy scores, and absorb cost-sharing differences caused by inaccurate listings.

"Annual statistical accuracy audit" is a statutory demand for exactly what Module 1 produces. Procurement begins 2026–27. An auditor should be independent of the vendor maintaining the data — our structural separation from plans is a selling point, not a gap.

---

## 6. Competition

| Tier | Players | What they do | Gap we exploit |
|---|---|---|---|
| Payment integrity leaders | Optum, Cotiviti, Gainwell, Zelis, Claritev | Claims editing, data mining, post-pay review | Point-in-time credentialing; no continuous physical verification |
| Provider data management | Kyruus, Quest Analytics, CAQH, Availity, LexisNexis, Symplr | Directory aggregation, attestation workflow | **Infer** accuracy from paper sources; do not **measure** ground truth |
| Government internal | CMS Fraud Prevention System, UPIC contractors | ML on claims data | Blind to non-claims signals; enforcement is post-payment |

**Our wedge:** incumbents reconcile paper against paper. Nobody independently verifies physical, current reality. The attestation process exists — plans send verification requests every 90 days as required — and providers ignore them, because it is unpaid administrative work with no felt consequence. Regulating the *process* produced paperwork, not accuracy.

**Cross-payer blind spot:** each payer sees only its own claims. A shell entity billing 12 payers small amounts is invisible to each individually. Public-data verification is inherently cross-payer.

---

## 7. SWOT

### Strengths
- **Zero PHI.** Every input is public by law. No BAA, no DUA, no HIPAA exposure, no procurement delay for data access.
- **Legally guaranteed data supply.** CMS-9115-F requires MA, Medicaid, and CHIP plans to expose a **public Provider Directory FHIR API with no authentication**. NPPES, OIG LEIE, and state boards are public records.
- **Radical cost advantage.** Manual secret-shopper verification is human phone labor; published studies cover ~120 listings. We operate at 10,000×.
- **Explainable by construction.** Weight-of-evidence scoring produces an audit trail, which is what distinguishes usable evidence from an interesting dashboard.
- **Independence.** Not owned by, and not selling data services to, the plans being audited.

### Weaknesses
- **No proprietary data.** Our inputs are public — anyone can obtain them.
- **Thin technical moat.** The differentiation is method and execution speed, not exclusive access.
- **Cannot see claim-level detail** without a customer relationship; Module 2 runs on aggregate public data until a payer engages.
- **Government sales cycles are long** — 6–18 months for state contracts.
- **Contingency model delays revenue** and requires runway.
- **Cannot determine network participation or new-patient acceptance** from public data alone — those require contacting the provider.

### Opportunities
- **REAL Health Providers Act** creates a statutory buyer with a PY2028 deadline and no mature tooling.
- **CMS's blunt-instrument response** (nationwide enrollment moratoria) signals unmet need for precision tools.
- **GAO scrutiny** of CMS fraud analytics creates political pressure to procure.
- **Litigation and AG enforcement** is active and funded — NY AG settlements, ERISA ghost-network class actions (*Hecht v. Cigna*), and a March 2026 court order compelling UnitedHealth to disclose its denial algorithm.
- **ERISA fiduciary exposure** creates a new buyer: employer plan sponsors who must know whether the network they purchased is real.
- **One engine, two markets** — directory accuracy and payment integrity are the same verification problem.

### Threats
- **Incumbent fast-follow.** Kyruus, Quest, or Cotiviti can bolt verification onto existing payer distribution. Our defense is method depth and independence, not exclusivity.
- **CMS builds in-house.** CMS is scaling its medical-record review workforce from 40 to 2,000 and expanding its Fraud Prevention System with ML.
- **Regulatory risk on the call layer.** The FCC's 2024 ruling brings AI-generated voice under TCPA; a pending NPRM would mandate in-call AI disclosure. Mitigation: business-line calling, mandatory disclosure by default, no recording in two-party consent states.
- **Data source instability.** Rate limits, ToS changes, or a state board redesign can break ingestion.
- **False-positive liability.** Wrongly flagging a legitimate provider carries reputational and legal risk. Mitigated by the three-state output and two-source confirmation rule.

---

## 8. Key Risks — Stated Plainly

**1. We cannot obtain real claims data.** Claims are PHI under HIPAA. Module 2 cannot be validated against real claim-level data without a covered-entity relationship and a BAA. Even de-identified CMS research files require an application, a data use agreement, a fee, and weeks of turnaround.

*Mitigation:* Module 1 runs entirely on public data and produces a real finding today. Module 2 launches on the public CMS Physician & Other Practitioners aggregate dataset — real data at provider level — and deepens to claim level only after a design-partner agreement. We do not claim claim-level capability we cannot demonstrate.

**2. False positives are the existential risk, not false negatives.** One wrongly accused legitimate provider discredits an entire finding.

*Mitigation:* three-state output; two independent signals required for any adverse classification; minimum-attempt protocols; pre-registered classification thresholds; published self-measured precision on a human-audited random subsample.

**3. The moat is thin.** We are executing a method, not holding an asset.

*Mitigation:* speed to design partners; depth in the messy state-registry integration layer that is unglamorous and slow to replicate; positioning as the independent auditor, which incumbents selling to plans structurally cannot occupy.

**4. Statistical anomaly ≠ fraud.** High billing volume can reflect a genuinely high-volume legitimate practice.

*Mitigation:* we produce prioritized leads with evidence, explicitly framed as investigative input, never as an accusation or an automated payment action.

---

## 9. Metrics That Matter

Procurement officers are not evaluated on TAM. Lead with:

| Metric | Why it matters |
|---|---|
| **Cost per entity verified** | vs. manual secret-shopper labor cost |
| **Recovery per dollar spent** | The ratio program integrity offices are measured on |
| **Time to finding** | Manual audit of 50 listings ≈ weeks; target 10,000+ in under an hour |
| **Precision on adverse flags** | Self-reported, measured on human-audited subsample |
| **Coverage rate** | % of population verifiable at all — always published alongside any score |

Every published score carries its denominator and a confidence interval. A score computed on 40% coverage is not comparable to one on 90%.

---

## 10. Roadmap

**Phase 0 — Hackathon**
Module 1 on one state × one payer × one specialty. Real public data end to end. Calibration curve from free NPPES/CMS labels. Call layer demonstrated on own line only.

**Phase 1 — 0–6 months**
Expand to full state coverage. Land one design partner (regional MCO or state program integrity office). Publish an independent audit as a credibility artifact — the Senate and academic secret-shopper studies established this precedent.

**Phase 2 — 6–18 months**
Module 2 on public CMS data. REAL Act compliance product for MA plans ahead of PY2028. First contingency-fee contract.

**Phase 3 — 18–36 months**
Cross-payer entity graph. Ownership-change monitoring. State Medicaid contracts.

---

## 11. Data Sources

All public, no PHI, no authentication barriers:

| Source | Contents | Access |
|---|---|---|
| NPPES / NPI Registry | NPI status, deactivation, taxonomy, address, phone | Public API + monthly/weekly/deactivation bulk files |
| Payer Provider Directory APIs | In-network listings | Public FHIR API, no auth (mandated by CMS-9115-F) |
| OIG LEIE | Federal program exclusions | Public download |
| CMS Doctors & Clinicians | Medicare enrollment, group affiliations | data.cms.gov |
| CMS Physician & Other Practitioners | 100% final-action Part B by NPI × HCPCS × POS | data.cms.gov |
| CMS Transparency in Coverage | Issuer-level claim denial rates | Public use file |
| State license boards | License status | ~50 heterogeneous public lookups |
| USPS Address API | Address validity and type | Public API |

---

## 12. Appendix — Key Figures

| Figure | Value | Source |
|---|---|---|
| Federal improper payments FY2025 | ~$94B | CMS |
| Addressable share after documentation deflator | ~$20–25B | Derived |
| DOJ 2025 takedown, intended losses | $14.6B | DOJ |
| Assets recovered from that takedown | ~$245M | DOJ |
| Operation Gold Rush (catheters/DME) | $10.6B | DOJ |
| LA County hospice fraud estimate | ~$3.5B | CMS |
| MA directory locations with ≥1 inaccuracy | 48.7% | CMS Online Provider Directory Review |
| MA plan error rate range | 9.6%–97.2% | CMS |
| Ghost psychiatrists in Medicaid directories | 43% | Health Services Research, 2026 |
| Senate secret-shopper: bookable appointments | 18% | Senate Finance Committee |
| Payment integrity market 2026 | $17.1B | Market research (directional) |
| MA overpayment vs. traditional Medicare, 2026 | $76B ($28B coding intensity) | MedPAC |

---

## Sources

- [CMS FY2025 Improper Payments Fact Sheet](https://cms.gov/newsroom/fact-sheets/fiscal-year-2025-improper-payments-fact-sheet)
- [DOJ 2025 National Health Care Fraud Takedown](https://www.justice.gov/usao-nd/pr/national-health-care-fraud-takedown-results-324-defendants-charged-connection-over-146)
- [CMS Online Provider Directory Review Report](https://www.cms.gov/medicare/health-plans/managedcaremarketing/downloads/provider_directory_review_industry_report_round_3_11-28-2018.pdf)
- [REAL Health Providers Act](https://questanalytics.com/news/requiring-enhanced-accurate-lists-of-health-providers-act/)
- [CMS Provider Directory API requirement (CMS-9115-F)](https://www.cms.gov/priorities/burden-reduction/overview/interoperability/frequently-asked-questions/provider-directory-api)
- [NPPES NPI Registry API](https://npiregistry.cms.hhs.gov/api-page)
- [CMS Medicare Physician & Other Practitioners dataset](https://data.cms.gov/resources/medicare-physician-other-practitioners-methodology)
- [Healthcare payment integrity market](https://www.mordorintelligence.com/industry-reports/healthcare-payment-integrity-market)
- [Healthcare fraud detection market](https://www.mordorintelligence.com/industry-reports/healthcare-fraud-detection-market)
- [CMS hospice and home health enrollment moratoria](https://www.cms.gov/newsroom/press-releases/cms-announces-aggressive-nationwide-crackdown-fraud-six-month-hospice-home-health-agency-enrollment)
- [GAO-26-107799: CMS's Use of Data Analytics to Identify and Prevent Fraud](https://files.gao.gov/reports/GAO-26-107799/index.html)
- [Ghost physicians in Medicaid registries (Health Services Research, 2026)](https://onlinelibrary.wiley.com/doi/10.1111/1475-6773.70089?af=R)
- [Senate Finance Committee ghost network secret shopper study](https://www.finance.senate.gov/imo/media/doc/050323%20Ghost%20Network%20Hearing%20-%20Secret%20Shopper%20Study%20Report.pdf)
- [MedPAC: MA overpayments 2026](https://www.healthcaredive.com/news/medicare-advantage-overpayments-76b-2026-medpac/809859/)
- [NY AG EmblemHealth ghost network settlement](https://www.propublica.org/article/emblem-health-ghost-network-settlement-mental-health)
- [LA hospice fraud takedown](https://www.foxla.com/news/la-hospice-fraud-multimillion-dollar-medicare-arrests)
- [AI voice agent TCPA/FCC compliance](https://www.henson-legal.com/ai-voice-compliance)
