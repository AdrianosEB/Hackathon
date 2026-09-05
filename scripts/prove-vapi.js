// --------------------------------------------------
// PROOF HARNESS
//
// Seven claims, each checked rather than asserted in
// prose. Every one runs offline against the fixture
// registry and the fixture websites.
//
//   node fixtures/nppes-fixture-server.js   :3101
//   node fixtures/website-server.js         :3102
//   ... then this.
//
// Exits non-zero if any proof fails.
// --------------------------------------------------

import "dotenv/config";

import { DatabaseSync } from "node:sqlite";

import { registryContact } from "../verification/sources/nppes.js";

import {
  dispatch,
  escalate,
  shouldEscalate,
  approveOutreach,
  getOutreach,
  listOutreach,
  createVapiAdapter,
  callsAlreadySentTo
} from "../verification/index.js";


// --------------------------------------------------
// Verification input, supplied explicitly.
//
// The provider axis is driven directly here rather
// than through the agent panel, for a reason worth
// stating: verification/agent-runtime.js — the module
// that implements AGENTS_LIVE — is imported by
// nothing. orchestrator.js calls the Agent SDK
// unconditionally, so the pipeline runs a live model
// whatever AGENTS_LIVE is set to, and its band is not
// reproducible run to run.
//
// Everything downstream of this object is the real
// thing: real escalate(), real registryContact()
// against the fixture registry, real website tier,
// real queue table, real dispatch(), real adapter.
// Only the band is stated rather than inferred.
// --------------------------------------------------

const UNMATCHED_PROVIDER = {
  dataConfidenceScore: 50,
  confidenceBand: "incomplete",
  blocking: false,
  blockingReason: null,
  checks: [],
  rationale:
    "Identity partially corroborated: the NPI is active and the name agrees, but the " +
    "practice address on the claim does not match the registry record."
};


const BASE = `http://localhost:${process.env.PORT || 3000}`;
const TOKEN = process.env.PROOF_TOKEN || "tok_alice";

let failures = 0;
let proofNumber = 0;

// Monday 2026-09-07, 17:00 UTC — mid-morning in every
// timezone these fixtures live in. Fixed so the
// call-window rule behaves the same on any day the
// proofs are run; today happens to be a Saturday, and
// escalate() correctly holds calls at the weekend.
const WEEKDAY = new Date("2026-09-07T17:00:00Z");


function heading(text) {
  proofNumber += 1;
  console.log(`\n${"=".repeat(72)}\nPROOF ${proofNumber} — ${text}\n${"=".repeat(72)}`);
}

function check(label, condition, detail = "") {
  const mark = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`  [${mark}] ${label}${detail ? `\n         ${detail}` : ""}`);
}

function show(label, value) {
  const text = value === undefined ? "(undefined)" : JSON.stringify(value, null, 2);
  console.log(`  ${label}:\n${text.split("\n").map((l) => `    ${l}`).join("\n")}`);
}


async function api(path, { method = "GET", body, token = TOKEN } = {}) {

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-outreach-token": token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  return { status: response.status, body: await response.json() };

}


// --------------------------------------------------
// Claims. Fixture NPIs only — every one starts with 9,
// a range CMS has never assigned.
// --------------------------------------------------

const CASCADE = {
  claimNumber: "PROOF-0001",
  providerName: "Cascade Imaging Partners",
  npi: "9000000023",
  practiceWebsite: "http://localhost:3102/cascade",
  practiceAddressLine1: "1500 Denny Way Ste 410",
  practiceCity: "Seattle",
  practiceState: "WA",
  practicePhone: "206-555-0142",
  patientLabel: "Patient B",
  diagnosisCodes: ["R10.9"],
  clinicalNote:
    "Abdominal pain, non-localised. CT abdomen and pelvis with contrast ordered to " +
    "exclude acute intra-abdominal pathology.",
  lineItems: [
    { code: "74177", description: "CT abdomen and pelvis with contrast",
      serviceDate: "2026-08-19", units: 1, amount: 470.00 }
  ]
};

// Same NPI, different claim. Proof 4.
const CASCADE_SECOND = {
  ...CASCADE,
  claimNumber: "PROOF-0002",
  lineItems: [
    { code: "71046", description: "Chest x-ray", serviceDate: "2026-08-21",
      units: 1, amount: 95.00 }
  ]
};

// Deactivated NPI. Blocking. Proof 3.
const SUMMIT = {
  claimNumber: "PROOF-0003",
  providerName: "Summit Care Group",
  npi: "9000000031",
  practiceAddressLine1: "15 Commerce Way",
  practiceCity: "Tempe",
  practiceState: "AZ",
  practicePhone: "480-555-0177",
  patientLabel: "Patient C",
  diagnosisCodes: ["M54.5"],
  clinicalNote: "Lower back pain, ongoing.",
  lineItems: [
    { code: "99214", description: "Office visit", serviceDate: "2026-08-20",
      units: 1, amount: 165.00 }
  ]
};

// Second escalating provider, left unapproved. Proof 6.
const HARBOR = {
  claimNumber: "PROOF-0004",
  providerName: "Harbor Point Internal Medicine",
  npi: "9000000072",
  practiceAddressLine1: "310 Harbor Point Rd",
  practiceCity: "Baltimore",
  practiceState: "MD",
  practicePhone: "410-555-0129",
  patientLabel: "Patient D",
  diagnosisCodes: ["E11.9"],
  clinicalNote: "Type 2 diabetes, routine follow-up.",
  lineItems: [
    { code: "99213", description: "Office visit", serviceDate: "2026-08-22",
      units: 1, amount: 110.00 }
  ]
};


// --------------------------------------------------
// Fresh state.
//
// The cooldown is persistent and per-provider — that
// is the point of proof 4 — so a second run of this
// harness would otherwise be refused by the results of
// the first. Clear only the fixture NPIs this file
// uses. Every one starts with 9, a range CMS has never
// assigned.
// --------------------------------------------------

function resetFixtureRows() {

  const db = new DatabaseSync("claim-integrity.db");

  const npis = ["9000000023", "9000000072", "9000000015", "9000000031"];

  const removed = db
    .prepare(
      `DELETE FROM outreach_queue WHERE npi IN (${npis.map(() => "?").join(",")})`
    )
    .run(...npis);

  db.close();

  console.log(
    `Reset: cleared ${removed.changes} prior outreach row(s) for the fixture NPIs.`
  );

}


async function main() {

  resetFixtureRows();

  // ================================================
  heading("Dry run: no adapter, no Vapi keys → the payload, and no call");
  // ================================================

  const queued = await escalate(CASCADE, UNMATCHED_PROVIDER, { now: WEEKDAY });

  check("outreach queued", queued.queued === true, queued.reason);
  check("tier 1, phone", queued.tier === 1 && queued.channel === "phone",
        `tier ${queued.tier} / ${queued.channel}`);

  const cascadeId = queued.outreachId;
  const cascadeRow = getOutreach(cascadeId);

  check("contact came from the registry, not the claim",
        /NPPES/i.test(cascadeRow.contactSource),
        `contact_source = "${cascadeRow.contactSource}"`);
  const registry = await registryContact(CASCADE.npi);
  check("the number queued is the one the federal registry holds",
        cascadeRow.contactValue === registry.phone,
        `queued ${cascadeRow.contactValue}, registry holds ${registry.phone} ` +
        `(source: ${registry.source})`);
  check("status is pending_approval, awaiting a human",
        cascadeRow.status === "pending_approval", `status = ${cascadeRow.status}`);

  const approved = await api(`/api/outreach/${cascadeId}/approve`, { method: "POST" });
  check("approved by a named operator over HTTP", approved.status === 200,
        `approvedBy = ${approved.body.approvedBy}`);

  const dry = await api(`/api/outreach/${cascadeId}/dispatch`, { method: "POST" });

  check("VAPI_ADAPTER is not armed", process.env.VAPI_ADAPTER !== "true");
  check("no Vapi keys present", !process.env.VAPI_API_KEY);
  check("dispatch reports a dry run", dry.body.dryRun === true);
  check("dispatched === false", dry.body.dispatched === false);
  check("status still 'approved', not 'sent'",
        getOutreach(cascadeId).status === "approved",
        `status = ${getOutreach(cascadeId).status}`);

  show("payload that WOULD have been sent", dry.body.wouldHaveSent);


  // ================================================
  heading("Armed adapter → exactly one call, to DEMO_BILLING_CONTACT");
  // ================================================

  const sent = [];

  const stubFetch = async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({ id: "call_proof_0001", status: "queued" })
    };
  };

  // Both switches on, for this proof only.
  process.env.DEMO_AUTO_CALL = "true";
  process.env.VAPI_API_KEY = "proof_key";
  process.env.VAPI_ASSISTANT_ID = "proof_assistant";
  process.env.VAPI_PHONE_NUMBER_ID = "proof_number";

  const adapter = createVapiAdapter({ fetchImpl: stubFetch });

  const result = await dispatch(cascadeId, { adapter });

  check("dispatched", result.dispatched === true);
  check("exactly one HTTP call to Vapi", sent.length === 1, `${sent.length} call(s)`);
  check("endpoint is Vapi's", sent[0]?.url === "https://api.vapi.ai/call", sent[0]?.url);
  check("called DEMO_BILLING_CONTACT",
        sent[0]?.body.customer.number === process.env.DEMO_BILLING_CONTACT,
        `dialled ${sent[0]?.body.customer.number}`);
  check("target mode is demo, not production", result.result.targetMode === "demo");
  check("did NOT dial the registry number",
        sent[0]?.body.customer.number !== cascadeRow.contactValue,
        `registry number ${cascadeRow.contactValue} was not dialled`);
  check("first turn discloses the AI",
        /automated AI assistant/i.test(sent[0]?.body.assistantOverrides.firstMessage));
  check("script mode is provider_confirmation",
        result.result.scriptMode === "provider_confirmation");
  check("status now 'sent'", getOutreach(cascadeId).status === "sent");

  show("first turn", sent[0]?.body.assistantOverrides.firstMessage);
  show("variableValues", sent[0]?.body.assistantOverrides.variableValues);

  // The second switch, independently.
  process.env.DEMO_AUTO_CALL = "false";
  let killSwitchRefusal = null;
  try {
    await createVapiAdapter({ fetchImpl: stubFetch })(getOutreach(cascadeId));
  } catch (error) {
    killSwitchRefusal = error.message;
  }
  check("DEMO_AUTO_CALL=false makes a wired adapter REFUSE (not silently dry-run)",
        killSwitchRefusal !== null, killSwitchRefusal);
  process.env.DEMO_AUTO_CALL = "true";
  check("still exactly one call", sent.length === 1, `${sent.length} call(s)`);


  // ================================================
  heading("Blocking discrepancy (NPI 9000000031, deactivated) → no call, ever");
  // ================================================

  // End to end, through the real pipeline.
  const blocked = await api("/api/claims/analyze", { method: "POST", body: SUMMIT });

  check("verification is blocking", blocked.body.verification?.blocking === true,
        blocked.body.verification?.blockingReason);
  check("routed to provider_data_review",
        blocked.body.routing?.queue === "provider_data_review",
        `queue = ${blocked.body.routing?.queue}`);
  check("decision is hold", blocked.body.routing?.decision === "hold");
  check("outreach refused to queue", blocked.body.outreach?.queued === false);
  check("outreach route is provider_data_review",
        blocked.body.outreach?.route === "provider_data_review",
        blocked.body.outreach?.reason);

  // And the rule itself, deterministically.
  const rule = shouldEscalate({ blocking: true, blockingReason: "deactivated NPI",
                                confidenceBand: "conflicting", dataConfidenceScore: 5 });
  check("shouldEscalate() refuses any blocking verification", rule.escalate === false,
        rule.reason);
  check("...and routes it to provider_data_review", rule.route === "provider_data_review");

  // Even if someone forced it past the rule.
  const forced = await escalate(SUMMIT, { blocking: true, blockingReason: "deactivated",
                                          confidenceBand: "conflicting",
                                          dataConfidenceScore: 5 });
  check("escalate() also refuses it", forced.queued === false, forced.reason);

  const summitRows = listOutreach().filter((row) => row.npi === "9000000031");
  check("no outreach row exists for this NPI at all", summitRows.length === 0,
        `${summitRows.length} row(s)`);
  check("no call was placed", sent.length === 1, `still ${sent.length} call(s) total`);


  // ================================================
  heading("Two claims, one NPI → one call. Cooldown holds.");
  // ================================================

  const second = await escalate(CASCADE_SECOND, UNMATCHED_PROVIDER, { now: WEEKDAY });

  check("second claim did NOT queue outreach", second.queued === false, second.reason);
  check("still exactly one call", sent.length === 1, `${sent.length} call(s)`);

  const priorCalls = callsAlreadySentTo("9000000023");
  check("the queue table records the prior call (persistent — survives a restart)",
        priorCalls.length === 1, `queue #${priorCalls[0]?.id}, sent ${priorCalls[0]?.updatedAt}`);

  // The dispatch-level guard, independently of queueing.
  let cooldownRefusal = null;
  try {
    await dispatch(cascadeId, { adapter });
  } catch (error) {
    cooldownRefusal = error.message;
  }
  check("re-dispatching the same row is refused", cooldownRefusal !== null,
        cooldownRefusal);
  check("still exactly one call", sent.length === 1, `${sent.length} call(s)`);


  // ================================================
  heading("Anonymous approval → refused");
  // ================================================

  const harborQueued = await escalate(HARBOR, UNMATCHED_PROVIDER, { now: WEEKDAY });
  const harborId = harborQueued.outreachId;
  check("second provider queued for outreach", Boolean(harborId),
        `outreach #${harborId}, tier ${harborQueued.tier} / ${harborQueued.channel}`);

  const noToken = await api(`/api/outreach/${harborId}/approve`,
    { method: "POST", token: null });
  check("no token → 401", noToken.status === 401, noToken.body.error);

  const badToken = await api(`/api/outreach/${harborId}/approve`,
    { method: "POST", token: "tok_not_a_real_operator" });
  check("wrong token → 401", badToken.status === 401, badToken.body.error);

  let anonRefusal = null;
  try {
    approveOutreach(harborId, "");
  } catch (error) {
    anonRefusal = error.message;
  }
  check("approveOutreach('') throws", anonRefusal !== null, anonRefusal);

  check("the item is still unapproved", getOutreach(harborId).status === "pending_approval",
        `status = ${getOutreach(harborId).status}`);

  // Forgery: the body cannot name someone else.
  const forgedApproval = await api(`/api/outreach/${harborId}/approve`,
    { method: "POST", body: { approvedBy: "Someone Else Entirely" } });
  check("body approvedBy is ignored; the token names the approver",
        forgedApproval.body.approvedBy === "Alice Chen",
        `recorded approver = ${forgedApproval.body.approvedBy}`);


  // ================================================
  heading("Dispatch of an unapproved item → refused");
  // ================================================

  // Harbor is approved now, so queue a fresh one and
  // leave it pending.
  const pendingQueued = await escalate(
    { ...HARBOR, claimNumber: "PROOF-0005", npi: "9000000015",
      providerName: "Riverbend Family Medicine" },
    UNMATCHED_PROVIDER,
    { now: WEEKDAY }
  );

  const pendingId = pendingQueued.outreachId;
  const pendingRow = getOutreach(pendingId);

  check("a fresh item is queued as pending_approval",
        pendingRow?.status === "pending_approval",
        `outreach #${pendingId}, status ${pendingRow?.status}`);

  let unapprovedRefusal = null;
  try {
    await dispatch(pendingId, { adapter });
  } catch (error) {
    unapprovedRefusal = error.message;
  }
  check("dispatching a pending_approval row is refused", unapprovedRefusal !== null,
        unapprovedRefusal);

  const unapprovedHttp = await api(`/api/outreach/${pendingId}/dispatch`,
    { method: "POST" });
  check("...over HTTP too", unapprovedHttp.status === 400, unapprovedHttp.body.error);

  check("still exactly one call", sent.length === 1, `${sent.length} call(s)`);


  // ================================================
  heading("Provider-facing script contains no claim content");
  // ================================================

  const spoken = [
    sent[0].body.assistantOverrides.firstMessage,
    ...Object.values(sent[0].body.assistantOverrides.variableValues)
  ].join("\n");

  const script = getOutreach(cascadeId).draft.script;
  const everything = `${spoken}\n${script}`;

  console.log("  Everything the assistant is given, in full:");
  console.log(everything.split("\n").map((l) => `    | ${l}`).join("\n"));
  console.log();

  // Asserted against the ACTUAL values on PROOF-0001,
  // not a pattern that might not match them.
  const mustNotAppear = [
    ["patient label", CASCADE.patientLabel],
    ["ICD-10 diagnosis code", CASCADE.diagnosisCodes[0]],
    ["CPT procedure code", CASCADE.lineItems[0].code],
    ["billed amount", String(CASCADE.lineItems[0].amount)],
    ["billed amount, formatted", CASCADE.lineItems[0].amount.toFixed(2)],
    ["procedure description", CASCADE.lineItems[0].description],
    ["clinical note", CASCADE.clinicalNote.slice(0, 40)]
  ];

  for (const [label, value] of mustNotAppear) {
    check(`${label} ${JSON.stringify(value)} is absent`, !everything.includes(value));
  }

  check("claim number is not spoken", !spoken.includes(CASCADE.claimNumber));
  check("claim number IS in metadata, for transcript correlation",
        sent[0].body.metadata.claimNumber === CASCADE.claimNumber);

  // The structural guard itself.
  const { assertNoClaimContent } = await import("../verification/outreach.js");

  const regressions = [
    ["a procedure code and an amount", "Confirm procedure 74177 billed at $470.00"],
    ["a diagnosis code", "The diagnosis on file is R10.9, please confirm"],
    ["a patient identifier", "Calling about Patient B"],
    ["a clinical note", "The clinical note mentions abdominal pain"]
  ];

  for (const [label, text] of regressions) {
    let threw = null;
    try {
      assertNoClaimContent(text, { what: "test" });
    } catch (error) {
      threw = error.message;
    }
    check(`the guard rejects ${label} if a future edit reintroduces it`, threw !== null,
          threw?.slice(0, 110));
  }

  // And the demo script cannot escape to production.
  process.env.VAPI_TARGET_MODE = "production";
  process.env.VAPI_PRODUCTION_ACKNOWLEDGEMENT =
    "I understand this dials real medical practices";
  process.env.VAPI_DEMO_SCRIPT = "true";

  const { buildCallVariables, resolveTarget } = await import("../verification/adapters/vapi.js");

  const productionTarget = resolveTarget(getOutreach(cascadeId));

  check("production mode resolves to the REGISTRY number, not the demo number",
        productionTarget.number === registry.phone &&
        productionTarget.mode === "production",
        `${productionTarget.mode} → ${productionTarget.number}`);

  let demoEscape = null;
  try {
    buildCallVariables(getOutreach(cascadeId), productionTarget);
  } catch (error) {
    demoEscape = error.message;
  }
  // Asserted on the message, so this cannot pass by
  // throwing for some unrelated reason — which is
  // exactly how it passed spuriously the first time.
  check("the claim-carrying demo script is refused in production mode",
        demoEscape !== null && /only permitted with VAPI_TARGET_MODE=demo/.test(demoEscape),
        demoEscape);

  // A website-sourced contact must never be dialled as
  // production: the practice authors that page.
  const websiteRow = { ...getOutreach(cascadeId),
    contactSource: "practice website (http://localhost:3102/cascade) — weaker than the registry" };

  let websiteRefusal = null;
  try {
    resolveTarget(websiteRow);
  } catch (error) {
    websiteRefusal = error.message;
  }
  check("a website-sourced contact is refused in production mode",
        websiteRefusal !== null, websiteRefusal?.slice(0, 120));

  // And production requires the second variable.
  delete process.env.VAPI_PRODUCTION_ACKNOWLEDGEMENT;
  let ackRefusal = null;
  try {
    resolveTarget(getOutreach(cascadeId));
  } catch (error) {
    ackRefusal = error.message;
  }
  check("production requires BOTH env vars, not one",
        ackRefusal !== null && /ACKNOWLEDGEMENT/.test(ackRefusal),
        ackRefusal?.slice(0, 120));

  process.env.VAPI_TARGET_MODE = "demo";
  process.env.VAPI_DEMO_SCRIPT = "false";
  delete process.env.VAPI_PRODUCTION_ACKNOWLEDGEMENT;


  // ================================================
  console.log(`\n${"=".repeat(72)}`);
  console.log(failures === 0
    ? `ALL ${proofNumber} PROOFS PASSED — ${sent.length} call placed in total.`
    : `${failures} CHECK(S) FAILED.`);
  console.log(`${"=".repeat(72)}\n`);

  process.exit(failures === 0 ? 0 : 1);

}


main().catch((error) => {
  console.error("\nProof harness crashed:", error);
  process.exit(1);
});
