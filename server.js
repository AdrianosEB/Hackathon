import "dotenv/config";
import express from "express";

import { analyzeClaim } from "./analyzer.js";

import {
  createClaim,
  getClaim,
  listClaims,
  getDashboardStats,
  saveClaimVerification
} from "./db.js";

// ---- verification layer ----
import {
  verifyProviderCached,
  triage,
  coverageReport,
  migrateClaimsTable,
  escalate,
  listOutreach,
  getOutreach,
  approveOutreach,
  rejectOutreach,
  recordOutcome,
  dispatch,
  createVapiAdapter,
  previewVapiCall,
  requireOutreachAuth,
  resolveApprover,
  OUTREACH_POLICY
} from "./verification/index.js";


// --------------------------------------------------
// Dispatch adapter
//
// main2 dialled from inside the analyze handler. That
// path is gone. Vapi is an ADAPTER now: the ladder in
// verification/outreach.js decides a call is
// warranted, a named human approves it, and dispatch()
// is the only thing that places it.
//
// Two switches, both required:
//
//   VAPI_ADAPTER=true   arms this constant
//   DEMO_AUTO_CALL=true checked inside the adapter
//
// With the first off, dispatch() gets no adapter and
// is a dry run — the default, and the right setting
// for a demo. With the first on and the second off,
// the adapter REFUSES rather than silently degrading
// to a dry run.
// --------------------------------------------------

const VAPI_ADAPTER =
  process.env.VAPI_ADAPTER === "true" ? createVapiAdapter() : null;


// Adds the NPI / practice-address / data-confidence columns
// to the existing claims table. Idempotent — safe on
// every boot, including against your current .db file.
migrateClaimsTable();


const app = express();

const PORT = Number(process.env.PORT || 3000);


// -------------------------
// Middleware
// -------------------------

app.use(
  express.json({
    limit: "5mb"
  })
);


// FIXED: your files live at the repo root, not in a
// /website folder, so the old static mount and the
// sendFile both 404'd. Serving the root directory
// makes /style.css and /script.js resolve.
app.use(express.static("."));

app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "." });
});


// -------------------------
// Health check
// -------------------------

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    verification: coverageReport()
  });
});


// -------------------------
// Which verifiers are live
//
// The UI reads this so it can state honestly what was
// and was not checked.
// -------------------------

app.get("/api/verification/coverage", (req, res) => {
  res.json(coverageReport());
});


// -------------------------
// Verify a provider on its own
//
// Handy for the demo: paste an NPI and watch the panel
// run, without building a whole claim around it.
// -------------------------

app.post("/api/providers/verify", async (req, res) => {

  const { npi, providerName } = req.body || {};

  if (!String(npi || "").trim() && !String(providerName || "").trim()) {

    return res.status(400).json({
      errors: ["Supply an npi or a providerName."]
    });

  }

  try {

    const verification = await verifyProviderCached({
      npi: String(npi || "").replace(/\D/g, ""),
      providerName: String(providerName || "").trim(),
      practiceAddressLine1: req.body.practiceAddressLine1,
      practiceCity: req.body.practiceCity,
      practiceState: req.body.practiceState,
      practicePhone: req.body.practicePhone,
      lineItems: []
    });

    res.json(verification);

  } catch (error) {

    res.status(502).json({
      error: "Provider verification failed to run.",
      detail: error.message
    });

  }

});


// -------------------------
// Get all claims
// -------------------------

app.get("/api/claims", (req, res) => {
  res.json(listClaims());
});


// -------------------------
// Get one claim
// -------------------------

app.get("/api/claims/:id", (req, res) => {

  const claim = getClaim(Number(req.params.id));

  if (!claim) {

    return res.status(404).json({
      error: "Claim not found."
    });

  }

  res.json(withRouting(claim));

});


// -------------------------
// Dashboard
// -------------------------

app.get("/api/dashboard", (req, res) => {

  res.json({
    stats: getDashboardStats(),
    claims: listClaims(50).map(withRouting),
    coverage: coverageReport()
  });

});


// -------------------------
// Analyze a claim
// -------------------------

app.post("/api/claims/analyze", async (req, res) => {

  const claim = req.body || {};

  const errors = validateClaim(claim);

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }


  const cleanClaim = {

    claimNumber:
      String(claim.claimNumber).trim(),

    providerName:
      String(claim.providerName).trim(),

    // ---- new provider-identity fields ----
    //
    // The NPI is the one that matters. Without it the
    // provider can only be guessed at by name, and
    // provider names are not unique.
    npi:
      String(claim.npi || "").replace(/\D/g, ""),

    practiceAddressLine1:
      String(claim.practiceAddressLine1 || "").trim(),

    practiceCity:
      String(claim.practiceCity || "").trim(),

    practiceState:
      String(claim.practiceState || "").trim().toUpperCase(),

    practicePhone:
      String(claim.practicePhone || "").trim(),

    // Optional. Used for tier-0 contact discovery only —
    // never as evidence about the provider, since they
    // author the page.
    practiceWebsite:
      String(claim.practiceWebsite || "").trim(),

    patientLabel:
      String(claim.patientLabel || "").trim(),

    diagnosisCodes:
      Array.isArray(claim.diagnosisCodes)
        ? claim.diagnosisCodes.map(String)
        : [],

    clinicalNote:
      String(claim.clinicalNote || "").trim(),

    lineItems:
      claim.lineItems.map((item) => ({
        code: String(item.code || "").trim(),
        description: String(item.description || "").trim(),
        serviceDate: String(item.serviceDate || "").trim(),
        units: Number(item.units || 1),
        amount: Number(item.amount || 0)
      }))

  };


  // ---- Axis 1: is the CLAIM anomalous? ----
  // Deterministic, instant, unchanged.

  const analysis = analyzeClaim(cleanClaim);


  // ---- Axis 2: is the PROVIDER real? ----
  //
  // Agent-driven, therefore slow and fallible. A
  // verification failure must never block claim
  // intake, so it degrades to "incomplete" rather
  // than throwing.

  let verification;

  try {

    verification = await verifyProviderCached(cleanClaim);

  } catch (error) {

    verification = {
      dataConfidenceScore: null,
      confidenceBand: "incomplete",
      blocking: false,
      checks: [],
      coverage: coverageReport(),
      rationale:
        "Provider verification did not complete, so this provider is unverified. " +
        "That reflects our own failure, not anything about the provider.",
      error: error.message
    };

  }


  // ---- Compose ----

  const routing = triage(analysis, verification);


  // ---- Escalate, if the provider came back unclear ----
  //
  // Drafts a call script (or an email) and puts it in
  // the approval queue. Nothing is sent here — see
  // verification/outreach.js. A blocking discrepancy never escalates.

  let outreach;

  try {

    outreach = await escalate(cleanClaim, verification);

  } catch (error) {

    outreach = {
      queued: false,
      reason: `Outreach could not be evaluated: ${error.message}`
    };

  }


  const savedClaim = createClaim(cleanClaim, analysis);

  // Record the provider axis against the claim so the
  // dashboard can show both axes, not just the claim's
  // own numbers.
  saveClaimVerification(savedClaim.id, verification);

  res.status(201).json({
    ...savedClaim,
    verification,
    routing,
    outreach
  });

});


// -------------------------
// Outreach queue
//
// Everything below is a human-in-the-loop control
// surface. Nothing dials or sends without a named
// person approving it first.
// -------------------------

// Everything under /api/outreach requires a token.
// These routes approve and place telephone calls;
// they do not run open. See verification/auth.js.
app.use("/api/outreach", requireOutreachAuth);


app.get("/api/outreach", (req, res) => {
  res.json({
    policy: {
      cooldownDays: OUTREACH_POLICY.cooldownMs / (24 * 60 * 60 * 1000),
      callWindow: OUTREACH_POLICY.callWindow,
      maxPhoneAttempts: OUTREACH_POLICY.maxPhoneAttempts,
      escalateBands: [...OUTREACH_POLICY.escalateBands]
    },
    items: listOutreach(req.query.status || null)
  });
});


app.get("/api/outreach/:id", (req, res) => {

  const item = getOutreach(req.params.id);

  if (!item) {
    return res.status(404).json({ error: "Not found." });
  }

  res.json(item);

});


// -------------------------
// Draft an approach, for demonstration
//
// The outreach ladder only fires when the provider
// axis comes back unresolved, and on these fixtures
// the identity panel usually resolves them — correctly.
// So the queue is normally empty, and the parts worth
// showing (the drafted call script, approval, dispatch,
// the Vapi payload) never get exercised.
//
// This runs the REAL escalate() against a REAL registry
// lookup, with one input stated rather than inferred:
// that our own verification did not complete. That is
// not a fabricated band — it is the documented
// "registry outage on our side" path in
// shouldEscalate(), and the queued row says so in its
// reason column, so nobody reading the audit trail
// later can mistake it for a finding about the
// provider.
//
// Nothing else is simulated. The contact still comes
// from NPPES, the cooldown still applies, approval is
// still required, and dispatch is still a dry run.
// -------------------------

app.post("/api/outreach/demo-escalate", async (req, res) => {

  const npi = String(req.body?.npi || "").replace(/\D/g, "");

  if (npi.length !== 10) {
    return res.status(400).json({ error: "Supply a 10-digit NPI." });
  }

  // The call window holds calls outside business hours
  // and at weekends, which is correct and also makes the
  // rest of the chain unreachable on a Saturday. Let the
  // caller ask for a weekday clock explicitly.
  const now = req.body?.assumeWeekday
    ? nextWeekdayMorning()
    : new Date();

  try {

    const result = await escalate(
      {
        npi,
        providerName: String(req.body?.providerName || "").trim() || "(from registry)",
        claimNumber: String(req.body?.claimNumber || "").trim() || null,
        practiceWebsite: String(req.body?.practiceWebsite || "").trim(),
        lineItems: []
      },
      {
        dataConfidenceScore: null,
        confidenceBand: "incomplete",
        blocking: false,
        blockingReason: null,
        checks: [],
        coverage: coverageReport(),
        rationale:
          "Demonstration: our own verification is treated as not having completed. This " +
          "says nothing about the provider."
      },
      { now }
    );

    res.json(result);

  } catch (error) {

    res.status(400).json({ error: error.message });

  }

});


function nextWeekdayMorning() {

  const date = new Date();

  // 18:00 UTC is mid-morning in every timezone the
  // fixtures live in: 10:00 Pacific through 13:00
  // Eastern, comfortably inside the 09:00-17:00 window.
  date.setUTCHours(18, 0, 0, 0);

  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date;

}


app.post("/api/outreach/:id/approve", (req, res) => {

  // Deliberately required. An audit trail that records
  // "system" as the approver is not an audit trail.
  //
  // With OUTREACH_OPERATORS configured the name is
  // derived from the token that authenticated the
  // request, so the body cannot sign someone else's
  // name to a call.
  const { approvedBy } = resolveApprover(req);

  if (!approvedBy) {
    return res.status(400).json({
      error: "approvedBy is required — approval must be attributable to a person."
    });
  }

  try {
    res.json(approveOutreach(req.params.id, approvedBy));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }

});


app.post("/api/outreach/:id/reject", (req, res) => {
  const { approvedBy } = resolveApprover(req);
  res.json(
    rejectOutreach(req.params.id, approvedBy || req.body?.rejectedBy, req.body?.note)
  );
});


app.post("/api/outreach/:id/dispatch", async (req, res) => {

  try {

    // VAPI_ADAPTER is null unless deliberately armed,
    // in which case dispatch() is a dry run and
    // returns the payload that would have gone out.
    const result = await dispatch(req.params.id, { adapter: VAPI_ADAPTER });

    if (result.dryRun) {

      // A dry run should show what it would have done,
      // not just say that it did nothing. Runs every
      // gate except the HTTP call.
      try {
        result.wouldHaveSent = previewVapiCall(result.outreach);
      } catch (error) {
        result.wouldHaveSent = { blocked: error.message };
      }

    }

    res.json(result);

  } catch (error) {

    res.status(400).json({ error: error.message });

  }

});


app.post("/api/outreach/:id/outcome", (req, res) => {

  try {
    res.json(
      recordOutcome(req.params.id, req.body?.outcome, req.body?.note)
    );
  } catch (error) {
    res.status(400).json({ error: error.message });
  }

});


// -------------------------
// Re-derive the routing decision for a stored claim
//
// triage() is a pure function of the two axes, so this
// costs nothing and avoids storing a decision that
// could drift out of step with the rule that produced
// it. A claim analysed before the provider axis was
// recorded simply has no routing.
// -------------------------

function withRouting(claim) {

  if (!claim?.verification) {
    return claim;
  }

  return {
    ...claim,
    routing: triage(
      { reviewLevel: claim.reviewLevel, observations: claim.observations },
      claim.verification
    )
  };

}


// -------------------------
// Validate claim input
// -------------------------

function validateClaim(claim) {

  const errors = [];

  if (!String(claim.claimNumber || "").trim()) {
    errors.push("Claim number is required.");
  }

  if (!String(claim.providerName || "").trim()) {
    errors.push("Provider name is required.");
  }

  // The NPI stays optional so the demo still runs
  // without one — but the response will say plainly
  // that the provider could not be identified.
  const npi = String(claim.npi || "").replace(/\D/g, "");

  if (npi && npi.length !== 10) {
    errors.push("NPI must be exactly 10 digits.");
  }

  if (
    !Array.isArray(claim.lineItems) ||
    claim.lineItems.length === 0
  ) {

    errors.push("At least one line item is required.");

  } else {

    claim.lineItems.forEach((item, index) => {

      if (!String(item.code || "").trim()) {
        errors.push(`Line ${index + 1}: procedure code is required.`);
      }

      if (!(Number(item.amount) >= 0)) {
        errors.push(`Line ${index + 1}: amount must be a number.`);
      }

    });

  }

  return errors;

}


// -------------------------
// Start server
// -------------------------

app.listen(PORT, () => {

  const coverage = coverageReport();

  console.log(`Claim Integrity running at http://localhost:${PORT}`);
  console.log(`Verifiers live: ${coverage.checked.join(", ") || "none"}`);
  console.log(`Coverage: ${Math.round(coverage.completeness * 100)}%`);

  console.log(
    `Outreach dispatch: ${
      VAPI_ADAPTER
        ? `VAPI ADAPTER ARMED (target mode: ${process.env.VAPI_TARGET_MODE || "demo"}, ` +
          `DEMO_AUTO_CALL=${process.env.DEMO_AUTO_CALL === "true" ? "true" : "false"})`
        : "dry run — no adapter wired"
    }`
  );

  console.log(
    `Outreach auth: ${
      process.env.OUTREACH_OPERATORS
        ? "named operator tokens"
        : process.env.OUTREACH_SHARED_SECRET
          ? "shared secret"
          : "UNCONFIGURED — /api/outreach will refuse every request"
    }`
  );

});
