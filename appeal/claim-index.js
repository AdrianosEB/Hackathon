// =============================================
// Claim record → verifiable facts
//
// The appeal argues about a claim. Indexing the
// claim once gives every later stage something
// concrete to check the prose against.
// =============================================

import { extractDates } from "./text-utils.js";


export function indexClaim(claim) {
  if (!claim || !Array.isArray(claim.lineItems)) {
    return {
      present: false,
      lineItems: [],
      codes: new Set(),
      diagnosisCodes: new Set(),
      serviceDates: new Set(),
      amounts: [],
      totalBilled: 0,
      unitsByCode: new Map()
    };
  }

  const lineItems = claim.lineItems.filter((item) => item.code || item.amount);

  const codes = new Set(
    lineItems.map((item) => String(item.code || "").trim()).filter(Boolean)
  );

  const serviceDates = new Set(
    lineItems
      .map((item) => normaliseDate(item.serviceDate))
      .filter(Boolean)
  );

  const amounts = lineItems.map((item) => Number(item.amount || 0));

  const unitsByCode = new Map();

  for (const item of lineItems) {
    const code = String(item.code || "").trim();

    if (!code) {
      continue;
    }

    unitsByCode.set(
      code,
      (unitsByCode.get(code) || 0) + Number(item.units || 1)
    );
  }

  return {
    present: lineItems.length > 0,
    claimNumber: String(claim.claimNumber || "").trim(),
    providerName: String(claim.providerName || "").trim(),
    patientLabel: String(claim.patientLabel || "").trim(),
    clinicalNote: String(claim.clinicalNote || "").trim(),
    lineItems,
    codes,
    diagnosisCodes: new Set(
      (claim.diagnosisCodes || []).map((code) => String(code).trim()).filter(Boolean)
    ),
    serviceDates,
    amounts,
    totalBilled: amounts.reduce((total, value) => total + value, 0),
    unitsByCode
  };
}


// =============================================
// Dates arrive as "2025-01-03" or "1/3/2025"
// =============================================

function normaliseDate(raw) {
  const value = String(raw || "").trim();

  if (!value) {
    return null;
  }

  const found = extractDates(value, []);

  return found.length > 0 ? found[0].date.toISOString().slice(0, 10) : null;
}


// =============================================
// Codes the appeal text refers to
//
// Only counted when the text labels them, so a
// five-digit dollar amount is never read as a
// procedure code.
// =============================================

export function codesCitedInText(text) {
  const procedure = new Set();
  const diagnosis = new Set();

  const labelled =
    /\b(?:CPT|HCPCS|procedure code|code)\s*#?\s*:?\s*(\d{5})\b/gi;

  let match;

  while ((match = labelled.exec(text)) !== null) {
    procedure.add(match[1]);
  }

  const icd = /\b([A-TV-Z]\d{2}(?:\.\d{1,4})?)\b/g;

  while ((match = icd.exec(text)) !== null) {
    diagnosis.add(match[1]);
  }

  return { procedure, diagnosis };
}
