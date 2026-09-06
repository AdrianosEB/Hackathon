// --------------------------------------------------
// VAPI DISPATCH ADAPTER
//
// This is main2's outbound-call integration, wired in
// as the last rung of the outreach ladder rather than
// as a trigger of its own.
//
// main2 called `triggerVapiClarification(claim, analysis)`
// from inside the analyze handler: the server decided,
// on its own, that a claim looked bad and dialled a
// phone. That path is not ported. What is ported is
// the part that was actually useful — the Vapi request
// shape — behind the approval chain that already
// exists here.
//
// The ladder decides a call is warranted.
// A named human approves it.
// dispatch() calls this.
//
// Signature is the one dispatch() already expects:
//
//   async (outreachRow) => result
//
// --------------------------------------------------
// TWO SWITCHES, BOTH MUST BE ON
// --------------------------------------------------
//
// 1. The adapter must be wired into dispatch() at all.
//    Absent, dispatch() is a dry run — that is its
//    default and the correct setting for a demo.
//
// 2. DEMO_AUTO_CALL must be "true".
//
// These are independent on purpose. Switch 1 is a code
// change; switch 2 is an environment change. An
// adapter that is present but disabled REFUSES — it
// does not quietly downgrade to a dry run, because a
// silent downgrade is how you find out later that you
// were never testing the thing you thought you were.
// --------------------------------------------------

import "dotenv/config";

import {
  assertNoClaimContent,
  callsAlreadySentTo
} from "../outreach.js";


const VAPI_CALL_ENDPOINT = "https://api.vapi.ai/call";


function envFlag(name) {
  // Exact-string compare, matching main2. A kill
  // switch should not be talked into "on" by a typo.
  return process.env[name] === "true";
}


// --------------------------------------------------
// WHICH AXIS WARRANTS A PHONE CALL
// --------------------------------------------------
//
// main2 called on the CLAIM axis: at least one
// high-severity finding in analysis.flags. This branch
// escalates on the PROVIDER axis: confidenceBand
// "incomplete" or "conflicting", and never on a
// blocking discrepancy.
//
// Those are different questions and only one of them
// is answerable by telephone.
//
// The decision here is the PROVIDER axis, for a reason
// that is stronger than preference: a call triggered
// by claim anomalies could not legally discuss the
// thing that triggered it. Rule 4 forbids naming the
// patient, the diagnosis, the note or the amount to a
// party we have not verified — which is the entire
// content of a claim-axis finding. main2's call
// existed to ask about procedure codes; this system
// may not say procedure codes out loud. The trigger
// and the sayable content have to match, and on the
// provider axis they do: we escalate because the
// registry record could not be matched, and matching
// the registry record is exactly what the script asks
// about.
//
// The secondary argument is the one in
// verification/index.js::triage — an anomalous claim
// from a well-matched provider is a coding question,
// resolved in the record by someone who can read the
// note. Nobody needs to be phoned about it.
//
// This is not re-checked here as a condition. It is
// STRUCTURAL: a tier-1 phone row exists in the queue
// only because shouldEscalate() fired on the provider
// axis. The assertions below confirm the row is what
// the ladder produced, not that some other rule agreed.
// --------------------------------------------------


// --------------------------------------------------
// WHO GETS CALLED  ── read this before changing it
// --------------------------------------------------
//
//   demo        → DEMO_BILLING_CONTACT, one fixed
//                 number, the developer's own phone,
//                 synthetic fixture data. No real
//                 practice is ever disturbed.
//
//   production  → the number on the outreach row,
//                 which came from registryContact()
//                 and therefore from NPPES. NEVER the
//                 number printed on the claim: the
//                 claim was submitted by the party
//                 being checked, so ringing its number
//                 asks a suspect party to vouch for
//                 itself on a line it chose. See rule
//                 1 in verification/outreach.js.
//
// Default is demo. Production requires TWO env vars,
// not one, and the second spells out what it means —
// so that nobody flips this on by pattern-matching a
// variable name in a config file.
// --------------------------------------------------

const TARGET_MODE_DEMO = "demo";
const TARGET_MODE_PRODUCTION = "production";

const PRODUCTION_ACKNOWLEDGEMENT =
  "I understand this dials real medical practices";


export function resolveTarget(row) {

  const requested =
    String(process.env.VAPI_TARGET_MODE || TARGET_MODE_DEMO).trim().toLowerCase();

  if (requested === TARGET_MODE_DEMO) {

    const number = String(process.env.DEMO_BILLING_CONTACT || "").trim();

    if (!number) {
      throw new Error(
        "VAPI_TARGET_MODE=demo requires DEMO_BILLING_CONTACT — the single fixed number " +
        "the demo is allowed to ring."
      );
    }

    return {
      mode: TARGET_MODE_DEMO,
      number,
      rationale:
        "DEMO. Ringing the fixed demo number with synthetic fixture data. The provider's " +
        "real registry number was NOT dialled."
    };

  }

  if (requested !== TARGET_MODE_PRODUCTION) {
    throw new Error(
      `VAPI_TARGET_MODE must be "${TARGET_MODE_DEMO}" or "${TARGET_MODE_PRODUCTION}", ` +
      `got "${requested}".`
    );
  }

  // ---- production path ----

  const ack = String(process.env.VAPI_PRODUCTION_ACKNOWLEDGEMENT || "").trim();

  if (ack !== PRODUCTION_ACKNOWLEDGEMENT) {
    throw new Error(
      `VAPI_TARGET_MODE=production also requires ` +
      `VAPI_PRODUCTION_ACKNOWLEDGEMENT="${PRODUCTION_ACKNOWLEDGEMENT}". This dials real ` +
      `medical practices. Two variables, because one is too easy to set by accident.`
    );
  }

  // Rule 1, checked rather than assumed. The row
  // records where its contact came from; if that does
  // not say the registry, we do not dial it.
  const source = String(row.contactSource || "");

  // Positive test for the registry, negative test for
  // the practice's own site — which is the source that
  // must never be dialled as though it were
  // independent, because the practice authors it.
  //
  // NOT a substring test for "claim": the tier-1 source
  // string is literally "NPPES registry (not the
  // claim)", and matching on that rejected every
  // legitimate registry contact.
  if (!/NPPES/i.test(source) || /website/i.test(source)) {
    throw new Error(
      `Refusing to dial: outreach #${row.id} recorded its contact source as ` +
      `"${source}". Production calls go to the federal registry number only — never a ` +
      `number the claim supplied, and never one scraped from the practice's own site.`
    );
  }

  const number = String(row.contactValue || "").trim();

  if (!number) {
    throw new Error(`Outreach #${row.id} has no contact number recorded.`);
  }

  return {
    mode: TARGET_MODE_PRODUCTION,
    number,
    rationale: `PRODUCTION. Dialling the NPPES registry number for NPI ${row.npi}.`
  };

}


// --------------------------------------------------
// WHAT THE ASSISTANT IS ALLOWED TO SAY
// --------------------------------------------------
//
// Two modes.
//
// provider_confirmation — the only mode permitted when
//   the call leaves for a real practice. Its variable
//   values are read from row.draft.providerFacts, the
//   allowlist built in outreach.js from the NPPES
//   contact record. It has no reference to the claim,
//   so it cannot include claim content by construction;
//   assertNoClaimContent() then re-checks the rendered
//   result so a later edit cannot regress it.
//
// demo_diagnostic — permitted ONLY in demo mode, and
//   demo mode rings one fixed number holding synthetic
//   data. This is the mode that may carry claim detail,
//   which is what main2's findingsText did.
//
// The gate is in buildCallVariables(): production and
// demo_diagnostic cannot both be true.
// --------------------------------------------------

const AI_DISCLOSURE_REQUIRED = true;


function firstTurn(draft) {

  // Several US states require a caller to disclose
  // that it is an AI, and the FCC treats
  // AI-generated voices as artificial under the TCPA.
  // composeCallScript() already carries the
  // instruction in `ifAutomated`; this is where it
  // stops being a note to a human and becomes the
  // assistant's opening line.
  const disclosure =
    "Hello — before we start, I should tell you that I'm an automated AI assistant, " +
    "not a person.";

  const note = String(draft?.ifAutomated || "");

  if (AI_DISCLOSURE_REQUIRED && !/AI/i.test(disclosure)) {
    throw new Error("The first turn must disclose that the caller is an AI system.");
  }

  return {
    firstMessage:
      `${disclosure} I'm calling from claims administration to confirm some practice ` +
      `details on file. This is a routine check, and I don't need any patient information.`,
    disclosureNote: note
  };

}


export function buildCallVariables(row, target) {

  const draft = row.draft || {};
  const facts = draft.providerFacts;

  if (!facts) {
    throw new Error(
      `Outreach #${row.id} has no providerFacts on its draft. Only call scripts composed ` +
      `by composeCallScript() can be dispatched — an ad-hoc draft has not been through ` +
      `the rule-4 allowlist.`
    );
  }

  const wantsDemoScript = envFlag("VAPI_DEMO_SCRIPT");

  if (wantsDemoScript && target.mode !== TARGET_MODE_DEMO) {
    throw new Error(
      "VAPI_DEMO_SCRIPT=true is only permitted with VAPI_TARGET_MODE=demo. The demo " +
      "script may carry claim detail, and that is acceptable only because the demo rings " +
      "one fixed number holding synthetic data."
    );
  }

  const scriptMode = wantsDemoScript ? "demo_diagnostic" : "provider_confirmation";

  // Provider-facing values. Allowlist only.
  const variableValues = {
    npi: facts.npi,
    providerName: facts.registeredName,
    practiceAddress: [facts.addressLine1, facts.city, facts.state]
      .filter(Boolean)
      .join(", "),
    purpose:
      "Confirm that this NPI belongs to this practice, that the address on file is " +
      "current, and whether billing is handled in-house or by a third party."
  };

  if (scriptMode === "demo_diagnostic") {

    // Demo only. Not reachable on the production path —
    // the guard above threw already.
    variableValues.demoClaimNumber = row.claimNumber || "";
    variableValues.demoReason = row.reason || "";

  }

  const turn = firstTurn(draft);

  if (scriptMode === "provider_confirmation") {

    // Second layer. Everything the assistant is given
    // for a provider-facing call is re-read here, and
    // anything claim-shaped that survived the
    // allowlist throws rather than being spoken.
    for (const [key, value] of Object.entries(variableValues)) {
      assertNoClaimContent(value, {
        allow: Object.values(facts),
        what: `provider-facing variable "${key}"`
      });
    }

    assertNoClaimContent(turn.firstMessage, {
      allow: Object.values(facts),
      what: "provider-facing first turn"
    });

    assertNoClaimContent(draft.script, {
      allow: Object.values(facts),
      what: "provider-facing call script"
    });

  }

  return { scriptMode, variableValues, ...turn };

}


// --------------------------------------------------
// The adapter
// --------------------------------------------------

export function createVapiAdapter({ fetchImpl = globalThis.fetch } = {}) {

  return async function vapiAdapter(row) {

    // ---- switch 2 ----
    if (!envFlag("DEMO_AUTO_CALL")) {
      throw new Error(
        "Vapi adapter is wired but DEMO_AUTO_CALL is not \"true\". Refusing to place a " +
        "call. Two switches must both be on before a phone rings: the adapter must be " +
        "passed to dispatch(), and DEMO_AUTO_CALL must be enabled."
      );
    }

    const required = [
      "VAPI_API_KEY",
      "VAPI_ASSISTANT_ID",
      "VAPI_PHONE_NUMBER_ID"
    ];

    const missing = required.filter((name) => !process.env[name]);

    if (missing.length > 0) {
      throw new Error(`Vapi is not configured. Missing: ${missing.join(", ")}.`);
    }

    // ---- the row must be what the ladder produced ----

    if (row.channel !== "phone" || row.tier !== 1) {
      throw new Error(
        `Outreach #${row.id} is tier ${row.tier} / ${row.channel}. The Vapi adapter ` +
        `places tier-1 phone calls only.`
      );
    }

    if (!String(row.approvedBy || "").trim()) {
      throw new Error(
        `Outreach #${row.id} has no approver recorded. A call is placed on a named ` +
        `person's authority or not at all.`
      );
    }

    // Belt and braces: dispatch() checks this too, but
    // an adapter that can be called directly should
    // not be the one place the cooldown is missing.
    const prior = callsAlreadySentTo(row.npi).filter((call) => call.id !== row.id);

    if (prior.length > 0) {
      throw new Error(
        `A call to NPI ${row.npi} already went out (queue #${prior[0].id}). Cooldown holds.`
      );
    }

    const target = resolveTarget(row);
    const call = buildCallVariables(row, target);

    const body = {

      assistantId: process.env.VAPI_ASSISTANT_ID,
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,

      // Returned with the call in Vapi webhook payloads
      // so a completed transcript can be associated
      // back to the queue row and the claim.
      metadata: {
        outreachId: row.id,
        npi: row.npi,
        claimNumber: row.claimNumber,
        approvedBy: row.approvedBy,
        targetMode: target.mode,
        scriptMode: call.scriptMode
      },

      customer: {
        number: target.number
      },

      assistantOverrides: {

        // The AI disclosure, as the assistant's opening
        // line rather than a note in a draft.
        firstMessage: call.firstMessage,

        variableValues: call.variableValues

      }

    };

    const response = await fetchImpl(VAPI_CALL_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.VAPI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.message || data?.error || JSON.stringify(data);
      throw new Error(`Vapi call failed: ${message}`);
    }

    return {
      provider: "vapi",
      callId: data.id,
      status: data.status || "created",
      calledNumber: target.number,
      targetMode: target.mode,
      scriptMode: call.scriptMode,
      rationale: target.rationale,
      request: body
    };

  };

}


// --------------------------------------------------
// What dispatch() would send, without sending it.
//
// Runs every gate the real adapter runs except the
// HTTP call, so a dry run tells you the truth about
// whether the real one would have worked.
// --------------------------------------------------

export function previewVapiCall(row) {

  const target = resolveTarget(row);
  const call = buildCallVariables(row, target);

  return {
    endpoint: VAPI_CALL_ENDPOINT,
    calledNumber: target.number,
    targetMode: target.mode,
    scriptMode: call.scriptMode,
    rationale: target.rationale,
    firstMessage: call.firstMessage,
    variableValues: call.variableValues
  };

}
