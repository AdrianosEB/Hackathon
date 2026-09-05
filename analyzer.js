// --------------------------------------------------
// CLAIM ANALYZER
//
// Answers one question: how much of this claim's own
// content needs a human to look at it?
//
// --------------------------------------------------
// VOCABULARY — read this before changing anything
// --------------------------------------------------
//
// Nothing in this file concludes fraud, and none of
// its output should be phrased as though it might.
// What we produce is a REVIEW PRIORITY: a statement
// about how much attention a claim warrants, not a
// statement about the honesty of whoever sent it.
//
// The distinction is not decorative. Duplicate line
// items are usually a resubmission or a clearinghouse
// glitch. High unit counts are usually correct. A
// short clinical note usually means a busy clinician,
// not an unsupported service. If the output says
// "anomaly" the reader hears "error"; if it says
// "suspicious" they hear "criminal". So:
//
//   reviewPriority   0-100, how much attention
//   reviewLevel      routine | review | priority
//   observations     what we noticed, with evidence
//
// Every observation must state what we saw and what
// innocent explanation exists for it. If you cannot
// name an innocent explanation, you have not
// understood the signal well enough to ship it.
// --------------------------------------------------


// --------------------------------------------------
// DEMO REFERENCE PRICES
//
// NOT authoritative reimbursement rates. Temporary
// values so price-comparison logic can be shown
// working. Replace with real reference data.
//
// Note: these are keyed by CPT code NUMBER only. CPT
// descriptors are copyrighted by the AMA and need a
// licence to redistribute — do not paste them in here.
// --------------------------------------------------

const REFERENCE_PRICES = {
  "99213": 110,
  "99214": 165,
  "99215": 230,
  "71046": 80,
  "74177": 450,
  "80053": 35,
  "85025": 25,
  "93000": 50
};


// Services where documentation is worth a second look.
const HIGH_INTENSITY_CODES = new Set(["99215", "74177"]);


export function analyzeClaim(claim) {

  const observations = [];

  const totalBilled = claim.lineItems.reduce(
    (total, item) => total + Number(item.amount || 0),
    0
  );

  let priority = 0;
  let reviewAmount = 0;


  // ==================================================
  // 1. Same code, same date, more than once
  // ==================================================

  const seen = new Map();

  for (const item of claim.lineItems) {

    const key = `${item.code}|${item.serviceDate || ""}`;

    if (seen.has(key)) {

      priority += 28;
      reviewAmount += Number(item.amount || 0);

      observations.push({
        type: "repeated_line",
        weight: "high",
        lineCode: item.code,
        observation:
          `Code ${item.code} appears more than once for ${item.serviceDate || "the same date"}.`,
        evidence:
          `Repeated line item, $${Number(item.amount || 0).toFixed(2)}.`,
        innocentExplanation:
          "Bilateral or repeated procedures are legitimately billed this way, and " +
          "resubmissions frequently duplicate a line. Modifiers usually resolve it."
      });

    }

    seen.set(key, true);

  }


  // ==================================================
  // 2. High unit counts
  // ==================================================

  for (const item of claim.lineItems) {

    const units = Number(item.units || 1);

    if (units >= 5) {

      priority += Math.min(18, units * 2);
      reviewAmount += Number(item.amount || 0) * 0.4;

      observations.push({
        type: "unit_count",
        weight: units >= 10 ? "high" : "medium",
        lineCode: item.code,
        observation: `Unit count of ${units} on code ${item.code}.`,
        evidence: `${units} units billed.`,
        innocentExplanation:
          "High unit counts are correct for many drug, supply, and time-based codes. " +
          "This marks the line for confirmation, nothing more."
      });

    }

  }


  // ==================================================
  // 3. Amount differs from the reference figure
  // ==================================================

  for (const item of claim.lineItems) {

    const referencePrice = REFERENCE_PRICES[item.code];
    const amount = Number(item.amount || 0);

    if (referencePrice && amount > referencePrice * 2.5) {

      priority += amount > referencePrice * 5 ? 25 : 16;
      reviewAmount += Math.max(0, amount - referencePrice);

      observations.push({
        type: "amount_variance",
        weight: amount > referencePrice * 5 ? "high" : "medium",
        lineCode: item.code,
        observation:
          `Billed amount for ${item.code} is well above this demo's reference figure.`,
        evidence:
          `$${amount.toFixed(2)} billed against a $${referencePrice.toFixed(2)} reference.`,
        innocentExplanation:
          "Charge amounts vary enormously by region, facility type, and contract. " +
          "A charge above a reference figure is not an overcharge — the reference is " +
          "a placeholder, not a fee schedule."
      });

    }

  }


  // ==================================================
  // 4. Documentation length
  //
  // Explicitly NOT a medical-necessity determination.
  // We are counting characters, which is all we can
  // honestly claim to be doing.
  // ==================================================

  const noteLength = (claim.clinicalNote || "").trim().length;

  for (const item of claim.lineItems) {

    if (HIGH_INTENSITY_CODES.has(item.code) && noteLength > 0 && noteLength < 90) {

      priority += 18;
      reviewAmount += Number(item.amount || 0) * 0.5;

      observations.push({
        type: "documentation_length",
        weight: "medium",
        lineCode: item.code,
        observation:
          `Brief documentation accompanying higher-intensity code ${item.code}.`,
        evidence:
          `Clinical note is ${noteLength} characters. This is a character count, not a ` +
          `judgement about the care delivered or whether it was warranted.`,
        innocentExplanation:
          "The full record almost always lives in the EHR rather than the claim. A short " +
          "note attached here says nothing about what was documented elsewhere."
      });

    }

  }


  // ==================================================
  // 5. No diagnosis supplied
  // ==================================================

  if (!claim.diagnosisCodes || claim.diagnosisCodes.length === 0) {

    priority += 12;

    observations.push({
      type: "missing_field",
      weight: "medium",
      observation: "No diagnosis code was supplied.",
      evidence: "diagnosisCodes was empty.",
      innocentExplanation:
        "Commonly an intake or interface problem rather than anything about the claim."
    });

  }


  // ==================================================

  priority = Math.min(100, Math.round(priority));

  reviewAmount = Math.min(
    totalBilled,
    Math.round(reviewAmount * 100) / 100
  );

  let reviewLevel = "routine";

  if (priority >= 60) {
    reviewLevel = "priority";
  } else if (priority >= 25) {
    reviewLevel = "review";
  }

  return {
    totalBilled,
    reviewPriority: priority,
    reviewAmount,
    reviewLevel,
    observations
  };

}
