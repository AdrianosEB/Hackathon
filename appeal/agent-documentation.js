// =============================================
// AGENT 4 — Documentation Completeness
//
// Checks the appeal against the evidence an
// adjudicator needs before it can be decided.
//
// Runs at every length — a two-line appeal is
// still missing the same items.
// =============================================

import { makeFinding } from "./finding.js";


// =============================================
// The checklist
//
// tier: "required" blocks adjudication,
//       "recommended" weakens the appeal.
// =============================================

const CHECKLIST = [
  {
    id: "claim_reference",
    label: "Claim or reference number",
    tier: "required",
    fromClaim: (claim) => (claim.claimNumber ? `Claim ${claim.claimNumber} on the record.` : null),
    pattern:
      /\bclaim\s*(?:#|no\.?|number|id|reference)\b|\bclaim\s*#?\s*[A-Z0-9][A-Z0-9-]{4,}\b|\bref(?:erence)?\s*(?:#|no\.?|number)\b/i,
    ask: "Please provide the claim number the appeal relates to."
  },
  {
    id: "denial_basis",
    label: "Denial reason / EOB or remittance reference",
    tier: "required",
    pattern:
      /\bexplanation of benefits\b|\bEOB\b|\bremittance\b|\bremark code\b|\bCARC\b|\bRARC\b|\bdenial (?:letter|notice|code|reason|rationale)\b|\bdenied (?:as|for|because|due to|citing)\b|\breason for denial\b/i,
    ask: "Please attach the denial letter or EOB and quote the denial reason code being appealed."
  },
  {
    id: "service_dates",
    label: "Date(s) of service",
    tier: "required",
    fromClaim: (claim) =>
      claim.serviceDates.size > 0
        ? `Service date(s) on the claim: ${[...claim.serviceDates].join(", ")}.`
        : null,
    detect: (context) => context.dates.length > 0,
    ask: "Please state the exact date(s) of service in dispute."
  },
  {
    id: "patient_identifier",
    label: "Patient / member identifier",
    tier: "required",
    fromClaim: (claim) => (claim.patientLabel ? `Patient ${claim.patientLabel} on the record.` : null),
    pattern:
      /\bmember\s*(?:id|no\.?|number|#)\b|\bpolicy\s*(?:no\.?|number|#|id)\b|\bsubscriber\b|\bpatient\s*(?:id|account|no\.?|number|#)\b|\bMRN\b|\bdate of birth\b|\bDOB\b/i,
    ask: "Please provide the member/policy number and patient identifier."
  },
  {
    id: "provider_identity",
    label: "Provider identity (NPI or tax ID)",
    tier: "required",
    fromClaim: (claim) => (claim.providerName ? `Provider ${claim.providerName} on the record.` : null),
    pattern:
      /\bNPI\b|\btax\s*id\b|\bTIN\b|\bEIN\b|\bprovider\s*(?:id|no\.?|number|#)\b|\bbilling provider\b/i,
    ask: "Please identify the rendering and billing provider, including NPI."
  },
  {
    id: "procedure_codes",
    label: "Procedure / diagnosis codes",
    tier: "required",
    fromClaim: (claim) =>
      claim.codes.size > 0
        ? `Billed: ${[...claim.codes].join(", ")}${
            claim.diagnosisCodes.size > 0
              ? `; diagnosis ${[...claim.diagnosisCodes].join(", ")}`
              : ""
          }.`
        : null,
    pattern:
      /\b(?:CPT|HCPCS|ICD-?9|ICD-?10|DRG|modifier)\b|\b[A-TV-Z]\d{2}(?:\.\d{1,4})?\b(?=[\s,.;)])/,
    ask: "Please list the CPT/HCPCS codes billed and the ICD-10 diagnosis codes supporting them."
  },
  {
    id: "clinical_records",
    label: "Clinical records",
    tier: "required",
    fromClaim: (claim) =>
      claim.clinicalNote.length >= 90
        ? `Clinical note of ${claim.clinicalNote.length} characters attached to the claim.`
        : null,
    pattern:
      /\b(?:medical|clinical|progress|chart|office|operative|treatment|therapy|nursing)\s+(?:record|records|note|notes|report|reports|documentation)\b|\bdischarge summary\b|\bhistory and physical\b|\blab (?:result|results|report)\b|\bimaging\b|\bradiology report\b|\bpathology report\b|\boperative report\b/i,
    ask: "Please attach the clinical records for the dates of service in dispute."
  },
  {
    id: "medical_necessity",
    label: "Medical-necessity statement",
    tier: "required",
    pattern:
      /\bmedical(?:ly)?\s+necess\w*\b|\bletter of medical necessity\b|\bLMN\b|\battending (?:physician )?(?:letter|statement|attestation)\b|\bclinical rationale\b|\bnecessity of\b/i,
    ask: "Please supply a signed medical-necessity statement from the treating clinician."
  },
  {
    id: "itemized_charges",
    label: "Itemised charges",
    tier: "recommended",
    fromClaim: (claim) =>
      claim.lineItems.length > 0
        ? `${claim.lineItems.length} itemised line(s) on the claim record.`
        : null,
    pattern:
      /\bitemi[sz]ed\b|\bline items?\b|\bcharge (?:detail|breakdown|master)\b|\bUB-?04\b|\bCMS-?1500\b|\bsuperbill\b|\bfee schedule\b/i,
    detect: (context) =>
      context.numbers.filter((number) => number.kind === "currency").length >= 3,
    ask: "Please attach the itemised bill showing each charge separately."
  },
  {
    id: "prior_authorization",
    label: "Prior authorisation / referral",
    tier: "recommended",
    pattern:
      /\bprior auth\w*\b|\bpre-?auth\w*\b|\bpreauthori[sz]ation\b|\bauthori[sz]ation\s*(?:no\.?|number|#|id)\b|\breferral\b|\bcertification\b/i,
    ask: "Was prior authorisation obtained? If so, please provide the authorisation number and date."
  },
  {
    id: "policy_language",
    label: "Plan or policy language cited",
    tier: "recommended",
    pattern:
      /\bplan (?:document|language|provision|booklet)\b|\bcertificate of coverage\b|\bpolicy\s+(?:section|provision|language|term)\b|\bsection\s+\d+(?:\.\d+)*\b|\bevidence of coverage\b|\bsummary plan description\b|\bSPD\b/i,
    ask: "Please quote the plan provision the appeal relies on, with section number."
  },
  {
    id: "timely_filing",
    label: "Timely-filing evidence",
    tier: "recommended",
    pattern:
      /\btimely filing\b|\bwithin \d+\s*(?:calendar |business )?days\b|\bfiling (?:deadline|limit|window)\b|\bdate of denial\b|\bappeal deadline\b/i,
    detect: (context) => context.dates.length >= 2,
    ask: "Please confirm the denial date and appeal submission date to establish timely filing."
  },
  {
    id: "signature_contact",
    label: "Signature and contact details",
    tier: "recommended",
    pattern:
      /\bsincerely\b|\brespectfully\b|\bsignature\b|\bsigned\b|\battestation\b|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/i,
    ask: "Please add a signature block with a direct contact name, phone, and email."
  },
  {
    id: "enclosures",
    label: "Enclosure / attachment list",
    tier: "recommended",
    pattern:
      /\benclos\w+\b|\battach\w+\b|\bexhibit\s+[A-Z0-9]\b|\bincluded (?:herewith|with this)\b|\bsee (?:the )?attached\b|\bappendix\b/i,
    ask: "Please enumerate the documents submitted with this appeal."
  }
];


// =============================================
// Wording that asserts evidence exists without
// naming or enclosing it
// =============================================

const ASSERTED_EVIDENCE =
  /\bas (?:documented|evidenced|shown|noted|described|supported)\b|\bthe records? (?:show|confirm|reflect|indicate|demonstrate)\b|\bour documentation (?:shows|confirms|supports)\b|\bit is well documented\b|\bwe have documentation\b|\ball (?:the )?(?:necessary|required|supporting) documentation\b/gi;


export function runDocumentationAgent(context) {
  const { text, sentences, claimIndex } = context;

  const claim = claimIndex && claimIndex.present ? claimIndex : null;

  const items = CHECKLIST.map((entry) => {
    // The claim record satisfies an item outright —
    // there is no point asking a submitter for a claim
    // number that is sitting on the claim.
    const claimEvidence =
      claim && entry.fromClaim ? entry.fromClaim(claim) : null;

    if (claimEvidence) {
      return {
        id: entry.id,
        label: entry.label,
        tier: entry.tier,
        status: "present",
        source: "claim record",
        evidence: claimEvidence,
        ask: entry.ask
      };
    }

    const patternHit = entry.pattern ? entry.pattern.test(text) : false;
    const detectHit = entry.detect ? entry.detect(context) : false;
    const present = patternHit || detectHit;

    return {
      id: entry.id,
      label: entry.label,
      tier: entry.tier,
      status: present ? "present" : "missing",
      source: present ? "appeal text" : null,
      evidence: present ? firstMatch(text, entry, context) : null,
      ask: entry.ask
    };
  });

  const findings = [];

  const missingRequired = items.filter(
    (item) => item.status === "missing" && item.tier === "required"
  );

  const missingRecommended = items.filter(
    (item) => item.status === "missing" && item.tier === "recommended"
  );

  for (const item of missingRequired) {
    findings.push(
      makeFinding({
        agent: "documentation",
        category: "missing_required_document",
        severity: "high",
        quote: item.label,
        start: null,
        end: null,
        sentences,
        message: `${item.label} is not referenced anywhere in the appeal.`,
        evidence:
          "No wording in the submitted text identifies or encloses this item.",
        ask: item.ask
      })
    );
  }

  for (const item of missingRecommended) {
    findings.push(
      makeFinding({
        agent: "documentation",
        category: "missing_supporting_document",
        severity: "medium",
        quote: item.label,
        start: null,
        end: null,
        sentences,
        message: `${item.label} is not referenced, which weakens the appeal.`,
        evidence:
          "No wording in the submitted text identifies or encloses this item.",
        ask: item.ask
      })
    );
  }

  // Evidence claimed in prose but nothing enumerated.
  const asserted = [...text.matchAll(ASSERTED_EVIDENCE)];
  const enclosureItem = items.find((item) => item.id === "enclosures");

  if (asserted.length > 0 && enclosureItem.status === "missing") {
    findings.push(
      makeFinding({
        agent: "documentation",
        category: "asserted_but_not_enclosed",
        severity: "high",
        quote: asserted[0][0],
        start: asserted[0].index,
        end: asserted[0].index + asserted[0][0].length,
        sentences,
        message: `The appeal asserts that records support it (${asserted.length} such statement(s)) but never identifies or encloses any document.`,
        evidence: asserted.map((match) => `"${match[0]}"`).join(", "),
        ask: "Please list each supporting document by name and date, and confirm it is enclosed."
      })
    );
  }

  const requiredTotal = items.filter((item) => item.tier === "required").length;
  const presentRequired = requiredTotal - missingRequired.length;

  return {
    agent: "evidence",
    findings,
    checklist: items,
    completeness: {
      requiredPresent: presentRequired,
      requiredTotal,
      recommendedPresent:
        items.filter(
          (item) => item.tier === "recommended" && item.status === "present"
        ).length,
      recommendedTotal: items.filter((item) => item.tier === "recommended")
        .length,
      percentComplete: Math.round((presentRequired / requiredTotal) * 100)
    }
  };
}


function firstMatch(text, entry, context) {
  if (entry.pattern) {
    const match = text.match(entry.pattern);

    if (match) {
      return `Matched "${match[0]}".`;
    }
  }

  if (entry.id === "service_dates" && context.dates.length > 0) {
    return `Dates found: ${context.dates.map((date) => date.raw).join(", ")}.`;
  }

  if (entry.id === "itemized_charges") {
    return "Three or more separate monetary amounts are itemised in the text.";
  }

  if (entry.id === "timely_filing") {
    return `Two or more dates present: ${context.dates
      .map((date) => date.raw)
      .join(", ")}.`;
  }

  return "Detected in the appeal text.";
}
