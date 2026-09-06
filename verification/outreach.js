// --------------------------------------------------
// OUTREACH ESCALATION
//
// When automated verification comes back inconclusive,
// go and ask the provider.
//
// This is the right instinct and it is worth naming
// why: the alternative is flagging a practice as
// unverified without ever giving them a chance to
// answer. Most screening systems do exactly that.
// Picking up the phone is due process.
//
// Ladder:
//
//   score good enough     -> nothing happens
//   BLOCKING DISCREPANCY  -> nothing happens (see below)
//   inconclusive          -> tier 0, the practice website
//   website yields nothing-> tier 1, phone
//   phone unresolved      -> tier 2, email, if one exists
//   still unresolved      -> tier 3, human reviewer
//
// Tier 0 exists so we look for a published contact
// before ringing a clinic. It bothers nobody, costs
// nothing, and is entirely deterministic — the page is
// read by regex, never by a model.
//
// --------------------------------------------------
// FOUR RULES, each of which exists because the obvious
// implementation is wrong.
// --------------------------------------------------
//
// 1. CONTACT DETAILS COME FROM THE REGISTRY, NEVER THE
//    CLAIM.
//
//    The claim was submitted by the party we are
//    checking. Ringing the number printed on it means
//    asking the party under review to vouch for themselves on a
//    line they chose. It produces a confirmation that
//    looks independent and isn't — worse than doing
//    nothing. Contacts come from NPPES or outreach
//    does not happen.
//
// 2. A BLOCKING DISCREPANCY NEVER ESCALATES.
//
//    If the NPI fails its check digit or the provider
//    is federally excluded, there is no verified party
//    to call. Calling anyway tips off whoever
//    submitted it and contaminates the record. These
//    go straight to the integrity queue.
//
// 3. NOTHING SENDS ITSELF.
//
//    Every call and email is DRAFTED and QUEUED for a
//    human to approve. An automated screening outcome
//    that autonomously dials real medical practices is
//    a different risk class from a read-only lookup —
//    TCPA, state AI-disclosure laws on calls, and the
//    plain fact that a wrong number here means
//    harassing a real clinic. dispatch() is a dry run
//    until someone deliberately wires a provider.
//
// 4. NO PHI LEAVES THE BUILDING.
//
//    Outreach confirms PROVIDER details only —
//    practice name, address, NPI. Never the patient,
//    the diagnosis, the clinical note, or the amount.
//    We are talking to a party we have not verified;
//    disclosing patient information to them would be
//    the actual breach.
// --------------------------------------------------

import { DatabaseSync } from "node:sqlite";
import { registryContact } from "./sources/nppes.js";
import { discoverFromWebsite } from "./sources/website.js";

const db = new DatabaseSync("claim-integrity.db");


db.exec(`

  CREATE TABLE IF NOT EXISTS outreach_queue (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    npi TEXT NOT NULL,

    provider_name TEXT,

    claim_number TEXT,

    tier INTEGER NOT NULL,              -- 0 web, 1 phone, 2 email, 3 human
    channel TEXT NOT NULL,              -- web | phone | email | none

    -- Recorded so an auditor can confirm we contacted
    -- the registry's number and not the claimant's.
    contact_value TEXT,
    contact_source TEXT NOT NULL,

    reason TEXT NOT NULL,
    draft TEXT NOT NULL,

    -- pending_approval -> approved -> sent -> resolved
    --                  -> rejected
    --                  -> blocked
    status TEXT NOT NULL DEFAULT 'pending_approval',

    approved_by TEXT,
    outcome TEXT,
    outcome_note TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL

  );

`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_outreach_npi
  ON outreach_queue (npi, created_at);
`);


// --------------------------------------------------
// Policy
// --------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

export const POLICY = {

  // Bands that trigger outreach. "probable" and
  // "confirmed" are left alone — do not ring a practice
  // that already checked out.
  //
  // "conflicting" IS included, and that is the important
  // one. A conflicting band that did not come from a blocking discrepancy
  // means several soft signals stacked up, none of
  // them conclusive — which is exactly the situation
  // where you ask the provider before recording an
  // negative conclusion, rather than the situation
  // where you skip straight to one. Blocking
  // discrepancies are the sole exception, and
  // shouldEscalate() catches those
  // first.
  escalateBands: new Set(["incomplete", "conflicting"]),

  // A practice must not be contacted repeatedly just
  // because it submitted several claims. One approach
  // per provider per fortnight, regardless of volume.
  cooldownMs: 14 * DAY,

  // Business hours in the practice's own timezone,
  // approximated from state. Calls outside these are
  // queued but held.
  callWindow: { startHour: 9, endHour: 17 },

  maxPhoneAttempts: 2

};


// --------------------------------------------------
// Should we escalate at all?
// --------------------------------------------------

export function shouldEscalate(verification) {

  // Rule 2. A blocking discrepancy is not a question we can resolve by
  // asking the party in question.
  if (verification.blocking) {

    return {
      escalate: false,
      reason:
        "Disqualifying finding. There is no verified party to contact, and contacting " +
        "whoever submitted this would tip them off and contaminate the record.",
      route: "provider_data_review"
    };

  }

  if (verification.dataConfidenceScore === null) {

    return {
      escalate: true,
      reason:
        "No verification check completed — most likely a registry outage on our side. " +
        "Confirming directly with the practice is the fastest way to resolve it.",
      route: "outreach"
    };

  }

  if (POLICY.escalateBands.has(verification.confidenceBand)) {

    return {
      escalate: true,
      reason:
        `Automated verification was inconclusive (${verification.confidenceBand}). ` +
        `Asking the practice directly is the appropriate next step before any negative ` +
        `conclusion is recorded.`,
      route: "outreach"
    };

  }

  return {
    escalate: false,
    reason: `Provider came back ${verification.confidenceBand}. No contact needed.`,
    route: null
  };

}


// --------------------------------------------------
// Cooldown
// --------------------------------------------------

function recentOutreach(npi) {

  const since = new Date(Date.now() - POLICY.cooldownMs).toISOString();

  return db
    .prepare(`
      SELECT * FROM outreach_queue
      WHERE npi = ? AND created_at > ?
      ORDER BY id DESC
    `)
    .all(String(npi).trim(), since);

}


// --------------------------------------------------
// Has a call already gone OUT to this provider?
//
// main2 tracked this in an in-memory Set keyed by
// claim number. Two things were wrong with that. The
// Set died with the process, so a restart re-called
// every provider; and keying on the CLAIM meant two
// claims from the same NPI were two calls, which is
// the thing POLICY.cooldownMs exists to prevent.
//
// outreach_queue is already persistent and already
// keyed by NPI. Ask it instead.
// --------------------------------------------------

export function callsAlreadySentTo(npi, { withinMs = POLICY.cooldownMs } = {}) {

  const since = new Date(Date.now() - withinMs).toISOString();

  return db
    .prepare(`
      SELECT * FROM outreach_queue
      WHERE npi = ?
        AND channel = 'phone'
        AND status IN ('sent', 'resolved')
        AND updated_at > ?
      ORDER BY id DESC
    `)
    .all(String(npi).trim(), since)
    .map(normalize);

}


// --------------------------------------------------
// Call-window check
//
// Crude state-to-offset mapping. Good enough to avoid
// queueing a call to California at 6am Pacific; not a
// substitute for a real timezone library if this ships.
// --------------------------------------------------

const STATE_UTC_OFFSET = {
  HI: -10, AK: -9,
  CA: -8, WA: -8, OR: -8, NV: -8,
  AZ: -7, CO: -7, UT: -7, NM: -7, MT: -7, WY: -7, ID: -7,
  TX: -6, IL: -6, MN: -6, WI: -6, IA: -6, MO: -6, AR: -6,
  LA: -6, OK: -6, KS: -6, NE: -6, SD: -6, ND: -6, MS: -6, AL: -6,
  NY: -5, NJ: -5, PA: -5, MA: -5, CT: -5, RI: -5, NH: -5, VT: -5,
  ME: -5, MD: -5, DE: -5, VA: -5, WV: -5, NC: -5, SC: -5, GA: -5,
  FL: -5, OH: -5, MI: -5, IN: -5, KY: -5, TN: -5, DC: -5
};


export function withinCallWindow(state, now = new Date()) {

  const offset = STATE_UTC_OFFSET[String(state || "").toUpperCase()];

  if (offset === undefined) {
    return { ok: true, note: "Timezone unknown; not held." };
  }

  const localHour = (now.getUTCHours() + offset + 24) % 24;
  const localDay = now.getUTCDay();

  if (localDay === 0 || localDay === 6) {
    return { ok: false, note: "Weekend in the practice's timezone." };
  }

  const inWindow =
    localHour >= POLICY.callWindow.startHour &&
    localHour < POLICY.callWindow.endHour;

  return {
    ok: inWindow,
    note: inWindow
      ? `Local time approximately ${localHour}:00.`
      : `Outside business hours locally (approximately ${localHour}:00). Held until morning.`
  };

}


// --------------------------------------------------
// Drafting
//
// Deliberately plain. This is a routine administrative
// confirmation, and it must read like one — no
// accusation, no mention of scores or observations, and
// nothing that would alarm a receptionist at a
// perfectly ordinary practice, which is what the great
// majority of these will be.
// --------------------------------------------------

// --------------------------------------------------
// WHAT MAY BE SPOKEN TO A PROVIDER
//
// Rule 4 says outreach confirms provider details only.
// Enforcing that by careful drafting is not enough: a
// script is a string, and the next person to edit the
// template has no way of knowing they broke a rule.
//
// So the provider-facing script is built from an
// ALLOWLIST. providerFacts() is the only source of
// substituted values, it reads a registryContact()
// result and nothing else, and it therefore has no
// path to the patient, the diagnosis, the clinical
// note or the amount — those live on the claim, and
// the claim is not in scope here.
//
// assertNoClaimContent() is the second layer: it
// re-reads the rendered text and throws if anything
// claim-shaped survived. The allowlist is what makes
// it correct; the assertion is what makes it stay
// correct.
// --------------------------------------------------

export function providerFacts(contact) {

  // Five fields. All from the federal registry record.
  // Adding a sixth is a deliberate act, and if it came
  // from the claim rather than the registry the
  // assertion below will refuse it.
  return {
    npi: String(contact.npi || "").trim(),
    registeredName: String(contact.registeredName || "").trim(),
    addressLine1: String(contact.address?.line1 || "").trim(),
    city: String(contact.address?.city || "").trim(),
    state: String(contact.address?.state || "").trim()
  };

}


// Claim-shaped patterns. Each maps to one of the four
// things Rule 4 names.
const CLAIM_CONTENT_PATTERNS = [
  [/\$\s*\d/,                          "a billed amount"],
  [/\b\d{5}\b/,                         "a procedure code (CPT/HCPCS)"],
  [/\b[A-TV-Z]\d{2}(?:\.\d{1,4})?\b/,   "a diagnosis code (ICD-10)"],
  // "Patient B", "Patient #4", "patient name" — but
  // NOT "I don't need any patient information", which
  // is the protective sentence the script opens with.
  [/\bpatient\s+(?:[a-z]\b|#|\d|name|id|label|record)/i, "a patient identifier"],
  [/\b(?:diagnos\w+|clinical note|CPT|HCPCS|ICD-?10|units billed|billed amount)\b/i,
                                       "claim content"]
];


// `allow` holds values already vetted as provider
// facts — an NPI is ten digits and a street address
// can legitimately contain five, so those are masked
// out before the scan rather than special-cased inside
// it. Everything not on the allowlist is scanned hard.
export function assertNoClaimContent(text, { allow = [], what = "script" } = {}) {

  let scanned = String(text || "");

  for (const value of allow) {
    const v = String(value || "").trim();
    if (v.length >= 2) {
      scanned = scanned.split(v).join(" ");
    }
  }

  for (const [pattern, description] of CLAIM_CONTENT_PATTERNS) {

    const hit = scanned.match(pattern);

    if (hit) {
      throw new Error(
        `Refusing to speak this ${what}: it contains ${description} ` +
        `(matched "${hit[0].trim()}"). Outreach confirms provider details only — ` +
        `see rule 4 in verification/outreach.js.`
      );
    }

  }

  return true;

}


export function composeCallScript(contact, verification, claimNumber) {

  // `verification` and `claimNumber` are deliberately
  // NOT read below. They are in the signature because
  // callers have them and a future rule might need
  // them for routing — but nothing derived from a
  // claim reaches the spoken text.
  const facts = providerFacts(contact);

  // Rule 4: provider details only.
  const script = [
    `Good morning — I'm calling from claims administration to confirm some practice`,
    `details on file. This is a routine check and I don't need any patient information.`,
    ``,
    `I have NPI ${facts.npi} registered to ${facts.registeredName}.`,
    ``,
    `Could you confirm:`,
    `  1. Is this the correct practice for that NPI?`,
    `  2. Is your current practice address still ${[
           facts.addressLine1,
           facts.city,
           facts.state
         ].filter(Boolean).join(", ")}?`,
    `  3. Is your billing handled in-house, or through a third-party biller?`,
    ``,
    `That's everything — thank you.`
  ].join("\n");

  // Checked here, at compose time, so a bad edit to
  // the template above fails before it is ever queued.
  assertNoClaimContent(script, {
    allow: Object.values(facts),
    what: "call script"
  });

  return {

    callTo: contact.phone,
    contactSource: `${contact.source} — ${contact.sourceUrl}`,

    // The allowlist, persisted. A dispatch adapter
    // building a provider-facing call reads THIS and
    // never the claim.
    providerFacts: facts,

    scriptMode: "provider_confirmation",

    script,

    doNotSay: [
      "Do not mention the patient, diagnosis, procedure codes, or billed amount.",
      "Do not mention a risk score, a flag, or an investigation.",
      "Do not accept identity confirmation from a number the claim supplied — this call " +
        "goes to the registry number only."
    ],

    // If this is ever handed to an automated voice
    // system rather than a person: several states now
    // require disclosure that the caller is AI, and the
    // FCC treats AI-generated voices as artificial
    // under the TCPA. Disclose at the top of the call.
    ifAutomated:
      "An automated caller must state that it is an AI system before anything else."

  };

}


export function composeEmail(contact, verification, claimNumber) {

  return {

    to: contact.email,
    contactSource: `${contact.source} — ${contact.sourceUrl}`,

    subject: `Confirmation of practice details — NPI ${contact.npi}`,

    body: [
      `Hello,`,
      ``,
      `We are confirming practice details held against NPI ${contact.npi}, registered to`,
      `${contact.registeredName}. This is a routine administrative check.`,
      ``,
      `Could you confirm the following?`,
      ``,
      `  - The practice associated with this NPI`,
      `  - Your current practice address`,
      `  - Whether billing is handled in-house or by a third party`,
      ``,
      `We do not need, and please do not send, any patient information in reply.`,
      ``,
      `Thank you,`,
      `Claims administration`
    ].join("\n"),

    notes: [
      "Address taken from the provider's NPPES record, not from the claim.",
      "No patient, clinical, or financial detail included.",
      "Transactional confirmation, not marketing — but include a real reply-to and a " +
        "postal address if this ever goes out at volume."
    ]

  };

}


// Local fixture websites need an explicit exemption
// from the SSRF guard. Granted by env var only, never
// inferred from the URL, so a submitted claim can
// never talk us into reaching inside our own network.
const ALLOW_LOCAL_WEBSITES =
  /^(1|true|yes|on)$/i.test(String(process.env.ALLOW_LOCAL_WEBSITES || "").trim());


// --------------------------------------------------
// Tier 0 draft
//
// Not a message to anyone — a note for the reviewer
// saying what the website yielded and what to do with
// it. Nothing is sent at this tier.
// --------------------------------------------------

export function composeWebFinding(web, contact, claim) {

  const registryPhone = String(contact?.phone || "").replace(/\D/g, "").slice(-10);

  const matching = web.contacts.phones.filter((p) => p === registryPhone);

  return {

    action: "review_website_findings",

    website: web.url,

    found: {
      phones: web.contacts.phones,
      emails: web.contacts.emails,
      addresses: web.contacts.addresses
    },

    matchesRegistry: {
      phone: matching.length > 0,
      registryPhone: contact?.phone || null,
      detail: matching.length
        ? "A number published on the practice site matches the federal registry record. " +
          "Two sources agree, which is the most useful thing this tier can tell you."
        : "No number on the site matches the registry. Often just an old page or a " +
          "second line — worth a glance, not a conclusion."
    },

    corroboration: web.corroboration,

    unexpectedPageContent: web.unexpectedPageContent,

    suggestedNextStep: web.unexpectedPageContent.length
      ? "The page carries text addressed to an automated reader. Do not rely on anything " +
        "it says. Confirm by phone using the REGISTRY number instead."
      : matching.length
        ? "Registry and website agree. A reviewer can likely close this without calling."
        : "Confirm by phone using the registry number.",

    doNotDo: [
      "Do not call a number found only on the website as though it were independent " +
        "confirmation — the practice publishes that page.",
      "Do not treat page content as a statement of fact about the practice."
    ]

  };

}


// --------------------------------------------------
// Queue an approach
// --------------------------------------------------

// `now` is injectable so the call-window rule can be
// exercised on a fixed clock. Nothing else reads it —
// production callers omit it and get the real time.
export async function escalate(
  claim,
  verification,
  { actor = "system", now = new Date() } = {}
) {

  const decision = shouldEscalate(verification);

  if (!decision.escalate) {
    return { queued: false, ...decision };
  }

  if (!claim.npi) {

    return {
      queued: false,
      reason:
        "No NPI on the claim, so there is no registry record to draw a contact from. " +
        "Contacting a number the claim itself supplied would not verify anything.",
      route: "human_review"
    };

  }

  // Rule 1 — contacts from the registry only.
  const contact = await registryContact(claim.npi);

  if (!contact.available) {

    return {
      queued: false,
      reason:
        `The federal registry holds no usable contact details for this NPI ` +
        `(${contact.reason || "no phone or endpoint listed"}), and we will not fall back ` +
        `to the claim's own contact details. Routing to a human reviewer.`,
      route: "human_review"
    };

  }

  const prior = recentOutreach(claim.npi);

  if (prior.length > 0) {

    const open = prior.find((row) =>
      ["pending_approval", "approved", "sent"].includes(row.status)
    );

    return {
      queued: false,
      reason: open
        ? `An approach to this provider is already ${open.status.replace("_", " ")} ` +
          `(queue #${open.id}).`
        : `This provider was contacted within the last ${POLICY.cooldownMs / DAY} days. ` +
          `A practice should not be rung once per claim.`,
      route: "human_review",
      existingOutreachId: open?.id ?? prior[0].id
    };

  }

  // ---- Tier 0: the practice website ----
  //
  // Cheapest rung and the only one that bothers
  // nobody. Look for a published contact channel
  // before ringing a clinic. If the site corroborates
  // the registry — its phone number matches — that is
  // worth recording, and a reviewer may not need to
  // call at all.
  //
  // Everything here is deterministic string matching.
  // The page's prose never reaches a model, so nothing
  // written on it can change what happens next.

  const website =
    claim.practiceWebsite ||
    verification?.discoveredWebsite ||
    null;

  // registryContact() and the NPPES record use
  // different field names. Passing the contact object
  // straight through silently degrades every
  // corroboration signal to "not found" — the lookups
  // miss, nothing throws, and a site that genuinely
  // matches reports as weak. Adapt explicitly.
  const registryRecord = {
    legalName: contact.registeredName,
    practiceAddress: contact.address || {}
  };

  const web = await discoverFromWebsite(website, {
    registryRecord,
    claim,
    allowLocal: ALLOW_LOCAL_WEBSITES
  });

  const webGaveContacts =
    web.reachable &&
    (web.contacts.phones.length > 0 || web.contacts.emails.length > 0);

  if (webGaveContacts) {

    const draft = composeWebFinding(web, contact, claim);

    const id = insert({
      npi: claim.npi,
      providerName: claim.providerName,
      claimNumber: claim.claimNumber,
      tier: 0,
      channel: "web",
      // Recorded, but note the source: a website contact
      // is weaker than a registry contact, because the
      // practice authors its own site.
      contactValue: web.contacts.phones[0] || web.contacts.emails[0] || null,
      contactSource: `practice website (${web.url}) — weaker than the registry`,
      reason: decision.reason,
      draft: JSON.stringify(draft, null, 2),
      status: "pending_approval"
    });

    return {
      queued: true,
      outreachId: id,
      tier: 0,
      channel: "web",
      status: "pending_approval",
      web,
      note:
        web.corroboration.corroborationLevel === "strong"
          ? "The practice website corroborates the registry, including a matching phone " +
            "number. A reviewer may be able to close this without calling."
          : "Contact details found on the practice website. Weaker than a registry match — " +
            "the practice controls that page.",
      reason: decision.reason
    };

  }


  // ---- Tier 1: phone ----
  //
  // Reached when the website yielded nothing usable:
  // no site, unreachable, or a placeholder page with
  // no contacts on it. That is the common case for
  // small practices and says nothing about them.

  const phoneAttempts = prior.filter((row) => row.channel === "phone").length;

  if (contact.phone && phoneAttempts < POLICY.maxPhoneAttempts) {

    const window = withinCallWindow(contact.address?.state, now);

    const draft = composeCallScript(contact, verification, claim.claimNumber);

    const id = insert({
      npi: claim.npi,
      providerName: claim.providerName,
      claimNumber: claim.claimNumber,
      tier: 1,
      channel: "phone",
      contactValue: contact.phone,
      contactSource: "NPPES registry (not the claim)",
      reason: decision.reason,
      draft: JSON.stringify({ ...draft, callWindow: window }, null, 2),
      status: window.ok ? "pending_approval" : "blocked"
    });

    return {
      queued: true,
      outreachId: id,
      tier: 1,
      channel: "phone",
      status: window.ok ? "pending_approval" : "blocked",
      note: window.ok
        ? "Call script drafted. Awaiting human approval before dialling."
        : `Held: ${window.note}`,
      reason: decision.reason
    };

  }

  // ---- Tier 2: email ----

  if (contact.email) {

    const draft = composeEmail(contact, verification, claim.claimNumber);

    const id = insert({
      npi: claim.npi,
      providerName: claim.providerName,
      claimNumber: claim.claimNumber,
      tier: 2,
      channel: "email",
      contactValue: contact.email,
      contactSource: `NPPES ${contact.emailType || "endpoint"} (not the claim)`,
      reason: decision.reason,
      draft: JSON.stringify(draft, null, 2),
      status: "pending_approval"
    });

    return {
      queued: true,
      outreachId: id,
      tier: 2,
      channel: "email",
      status: "pending_approval",
      note: "Email drafted. Awaiting human approval before sending.",
      reason: decision.reason
    };

  }

  // ---- Tier 3 ----

  const id = insert({
    npi: claim.npi,
    providerName: claim.providerName,
    claimNumber: claim.claimNumber,
    tier: 3,
    channel: "none",
    contactValue: null,
    contactSource: "none available",
    reason: decision.reason,
    draft: JSON.stringify({
      note:
        "Phone attempts exhausted and the registry lists no email endpoint. A human " +
        "reviewer should decide what happens next. The provider has not been reached, " +
        "which is not the same as anything being wrong."
    }, null, 2),
    status: "pending_approval"
  });

  return {
    queued: true,
    outreachId: id,
    tier: 3,
    channel: "none",
    status: "pending_approval",
    note: "Channels exhausted. Routed to a human reviewer.",
    reason: decision.reason
  };

}


function insert(row) {

  const now = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO outreach_queue (
      npi, provider_name, claim_number, tier, channel,
      contact_value, contact_source, reason, draft, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.npi, row.providerName || null, row.claimNumber || null,
    row.tier, row.channel, row.contactValue, row.contactSource,
    row.reason, row.draft, row.status, now, now
  );

  return Number(result.lastInsertRowid);

}


// --------------------------------------------------
// Queue management
// --------------------------------------------------

export function listOutreach(status = null, limit = 50) {

  const rows = status
    ? db.prepare(`
        SELECT * FROM outreach_queue WHERE status = ?
        ORDER BY id DESC LIMIT ?
      `).all(status, limit)
    : db.prepare(`
        SELECT * FROM outreach_queue ORDER BY id DESC LIMIT ?
      `).all(limit);

  return rows.map(normalize);

}


export function getOutreach(id) {
  const row = db.prepare("SELECT * FROM outreach_queue WHERE id = ?").get(Number(id));
  return row ? normalize(row) : null;
}


// Approval is a human act and is recorded as one.
// `approvedBy` is not optional — an audit trail with
// "system" in the approver column is not an audit trail.
export function approveOutreach(id, approvedBy) {

  if (!String(approvedBy || "").trim()) {
    throw new Error("approveOutreach requires the name of the person approving it.");
  }

  const row = getOutreach(id);

  if (!row) {
    throw new Error(`No outreach #${id}.`);
  }

  if (row.status !== "pending_approval") {
    throw new Error(`Outreach #${id} is "${row.status}", not awaiting approval.`);
  }

  db.prepare(`
    UPDATE outreach_queue
    SET status = 'approved', approved_by = ?, updated_at = ?
    WHERE id = ?
  `).run(String(approvedBy).trim(), new Date().toISOString(), Number(id));

  return getOutreach(id);

}


export function rejectOutreach(id, rejectedBy, note) {

  db.prepare(`
    UPDATE outreach_queue
    SET status = 'rejected', approved_by = ?, outcome_note = ?, updated_at = ?
    WHERE id = ?
  `).run(
    String(rejectedBy || "").trim() || null,
    note || null,
    new Date().toISOString(),
    Number(id)
  );

  return getOutreach(id);

}


export function recordOutcome(id, outcome, note) {

  const allowed = [
    "confirmed",        // practice confirmed details — provider is fine
    "contradicted",     // practice denies the NPI or the address
    "no_answer",
    "unreachable",      // number dead or disconnected
    "refused"
  ];

  if (!allowed.includes(outcome)) {
    throw new Error(`Outcome must be one of: ${allowed.join(", ")}.`);
  }

  db.prepare(`
    UPDATE outreach_queue
    SET status = 'resolved', outcome = ?, outcome_note = ?, updated_at = ?
    WHERE id = ?
  `).run(outcome, note || null, new Date().toISOString(), Number(id));

  return getOutreach(id);

}


// --------------------------------------------------
// Dispatch
//
// Dry run by default, and it should stay that way for
// the demo. Wiring a real telephony or email provider
// is a deliberate act with real obligations attached —
// see the header. Nothing reaches this function that a
// named human has not approved.
// --------------------------------------------------

export async function dispatch(id, { adapter = null } = {}) {

  const row = getOutreach(id);

  if (!row) {
    throw new Error(`No outreach #${id}.`);
  }

  if (row.status !== "approved") {
    throw new Error(
      `Outreach #${id} is "${row.status}". Only human-approved items can be dispatched.`
    );
  }

  // Per-provider cooldown, enforced at the point of
  // dispatch rather than only at queueing time.
  // Approval can sit in the queue for days, and it is
  // the dial that must not repeat — not the draft.
  // Applies to every adapter, so a second telephony
  // provider cannot reintroduce the bug.
  if (row.channel === "phone") {

    const priorCalls = callsAlreadySentTo(row.npi).filter((call) => call.id !== row.id);

    if (priorCalls.length > 0) {

      throw new Error(
        `A call to NPI ${row.npi} was already placed (queue #${priorCalls[0].id}, ` +
        `${priorCalls[0].updatedAt}). POLICY.cooldownMs is ` +
        `${POLICY.cooldownMs / DAY} days — a practice is not rung once per claim.`
      );

    }

  }

  if (!adapter) {

    return {
      dispatched: false,
      dryRun: true,
      outreach: row,
      note:
        "No dispatch adapter configured, so nothing was sent. This is the default and " +
        "the right setting for a demo — the draft above is what would have gone out."
    };

  }

  const result = await adapter(row);

  db.prepare(`
    UPDATE outreach_queue SET status = 'sent', updated_at = ? WHERE id = ?
  `).run(new Date().toISOString(), Number(id));

  return { dispatched: true, dryRun: false, outreach: getOutreach(id), result };

}


function normalize(row) {

  let draft;

  try {
    draft = JSON.parse(row.draft);
  } catch {
    draft = row.draft;
  }

  return {
    id: row.id,
    npi: row.npi,
    providerName: row.provider_name,
    claimNumber: row.claim_number,
    tier: row.tier,
    channel: row.channel,
    contactValue: row.contact_value,
    contactSource: row.contact_source,
    reason: row.reason,
    draft,
    status: row.status,
    approvedBy: row.approved_by,
    outcome: row.outcome,
    outcomeNote: row.outcome_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

}
