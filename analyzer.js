// --------------------------------------------------
// DEMO REFERENCE PRICES
//
// IMPORTANT:
//
// These are NOT authoritative reimbursement rates.
//
// They are temporary hackathon values so we can
// demonstrate price-outlier detection.
//
// Eventually replace them with real reference data.
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


// Some services we want to examine more carefully

const HIGH_INTENSITY_CODES =
  new Set([
    "99215",
    "74177"
  ]);


// --------------------------------------------------
// Main claim analysis function
// --------------------------------------------------

export function analyzeClaim(claim) {

  const flags = [];


  // Calculate total claim amount

  const totalBilled =
    claim.lineItems.reduce(
      (total, item) =>
        total + Number(item.amount || 0),
      0
    );


  let score = 0;

  let reviewAmount = 0;


  // ==================================================
  // RULE 1
  //
  // Duplicate procedure code on the same service date
  // ==================================================

  const seen = new Map();


  for (const item of claim.lineItems) {

    const key =
      `${item.code}|${item.serviceDate || ""}`;


    if (seen.has(key)) {

      score += 28;

      reviewAmount +=
        Number(item.amount || 0);


      flags.push({

        type: "duplicate",

        severity: "high",

        lineCode: item.code,

        message:
          `Possible duplicate billing: ${item.code} appears more than once on ${item.serviceDate || "the same date"}.`,

        evidence:
          `Repeated line item with billed amount $${Number(item.amount || 0).toFixed(2)}.`

      });

    }


    seen.set(key, true);

  }


  // ==================================================
  // RULE 2
  //
  // Unusually high quantity / units
  // ==================================================

  for (const item of claim.lineItems) {

    const units =
      Number(item.units || 1);


    if (units >= 5) {

      score +=
        Math.min(
          18,
          units * 2
        );


      reviewAmount +=
        Number(item.amount || 0) * 0.4;


      flags.push({

        type: "quantity",

        severity:
          units >= 10
            ? "high"
            : "medium",

        lineCode:
          item.code,

        message:
          `Unusually high unit count (${units}) for code ${item.code}.`,

        evidence:
          "High quantities can be valid, but this line deserves manual validation."

      });

    }

  }


  // ==================================================
  // RULE 3
  //
  // Price outlier
  // ==================================================

  for (const item of claim.lineItems) {

    const referencePrice =
      REFERENCE_PRICES[item.code];


    const amount =
      Number(item.amount || 0);


    // Only evaluate codes for which we currently
    // have a demo reference price.

    if (
      referencePrice &&
      amount > referencePrice * 2.5
    ) {

      const excessAmount =
        Math.max(
          0,
          amount - referencePrice
        );


      score +=
        amount > referencePrice * 5
          ? 25
          : 16;


      reviewAmount +=
        excessAmount;


      flags.push({

        type: "price_outlier",

        severity:
          amount > referencePrice * 5
            ? "high"
            : "medium",

        lineCode:
          item.code,

        message:
          `Billed amount for ${item.code} is far above this demo's reference value.`,

        evidence:
          `$${amount.toFixed(2)} billed vs. $${referencePrice.toFixed(2)} demo reference.`

      });

    }

  }


  // ==================================================
  // RULE 4
  //
  // Limited clinical documentation
  //
  // This does NOT determine medical necessity.
  //
  // It simply identifies situations where a
  // high-intensity service has very little
  // accompanying documentation.
  // ==================================================

  const noteLength =
    (claim.clinicalNote || "")
      .trim()
      .length;


  for (const item of claim.lineItems) {

    if (
      HIGH_INTENSITY_CODES.has(item.code) &&
      noteLength > 0 &&
      noteLength < 90
    ) {

      score += 18;


      reviewAmount +=
        Number(item.amount || 0) * 0.5;


      flags.push({

        type: "documentation",

        severity: "medium",

        lineCode:
          item.code,

        message:
          `Documentation may be too limited to clearly support higher-intensity code ${item.code}.`,

        evidence:
          `Clinical note is only ${noteLength} characters long. This is a screening signal, not a coverage determination.`

      });

    }

  }


  // ==================================================
  // RULE 5
  //
  // Missing diagnosis information
  // ==================================================

  if (
    !claim.diagnosisCodes ||
    claim.diagnosisCodes.length === 0
  ) {

    score += 12;


    flags.push({

      type: "missing_context",

      severity: "medium",

      message:
        "No diagnosis code was supplied with the claim.",

      evidence:
        "Diagnosis context is needed for procedure-to-diagnosis validation."

    });

  }


  // ==================================================
  // Final score
  // ==================================================

  score =
    Math.min(
      100,
      Math.round(score)
    );


  // Never let our estimated review amount exceed
  // the entire claim amount.

  reviewAmount =
    Math.min(
      totalBilled,
      Math.round(
        reviewAmount * 100
      ) / 100
    );


  // Convert numeric score to label

  let riskLevel = "low";


  if (score >= 60) {

    riskLevel = "high";

  } else if (score >= 25) {

    riskLevel = "review";

  }


  return {

    totalBilled,

    riskScore: score,

    reviewAmount,

    riskLevel,

    flags

  };

}