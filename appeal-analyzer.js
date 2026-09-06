// ==================================================
// APPEAL ANALYZER
//
// Deterministic review of an appeal against the
// ORIGINAL claim findings.
//
// IMPORTANT:
//
// This does NOT:
// - determine fraud,
// - make a payment decision,
// - determine medical necessity,
// - or replace human review.
//
// It only asks:
//
// "Does the corrected appeal data remove or address
// the exact deterministic condition that caused the
// original finding?"
// ==================================================


// --------------------------------------------------
// DEMO REFERENCE PRICES
//
// Keep these aligned with analyzer.js.
//
// These are NOT authoritative reimbursement rates.
// They are hackathon demo reference values.
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


// --------------------------------------------------
// High-intensity demo codes
//
// Keep aligned with analyzer.js.
// --------------------------------------------------

const HIGH_INTENSITY_CODES =
  new Set([
    "99215",
    "74177"
  ]);


// ==================================================
// MAIN APPEAL ANALYSIS FUNCTION
// ==================================================

export function analyzeAppeal(
  originalClaim,
  appeal
) {

  const originalFlags =
    Array.isArray(originalClaim?.flags)
      ? originalClaim.flags
      : [];

  const appealLineItems =
    Array.isArray(appeal?.lineItems)
      ? appeal.lineItems
      : [];

  const results = [];


  // ------------------------------------------------
  // Only evaluate original RULE findings.
  //
  // The original claim may contain findings detected
  // by rules, AI, or both.
  //
  // This deterministic appeal analyzer should only
  // judge findings that came from deterministic rules.
  // ------------------------------------------------

  const ruleFlags =
    originalFlags.filter(
      (flag) => {

        if (
          !Array.isArray(
            flag?.detectedBy
          )
        ) {

          // Older / rule-only stored findings may not
          // have detectedBy. Treat them as rule findings.
          return true;

        }

        return flag.detectedBy.includes(
          "rules"
        );

      }
    );


  // ------------------------------------------------
  // Evaluate every original deterministic finding
  // individually.
  // ------------------------------------------------

  for (
    const flag
    of ruleFlags
  ) {

    let result;


    switch (
      flag.type
    ) {


      // ============================================
      // DUPLICATE
      // ============================================

      case "duplicate":

        result =
          evaluateDuplicateFinding(
            flag,
            appealLineItems
          );

        break;


      // ============================================
      // QUANTITY
      // ============================================

      case "quantity":

        result =
          evaluateQuantityFinding(
            flag,
            appealLineItems
          );

        break;


      // ============================================
      // PRICE OUTLIER
      // ============================================

      case "price_outlier":

        result =
          evaluatePriceFinding(
            flag,
            appealLineItems
          );

        break;


      // ============================================
      // DOCUMENTATION
      // ============================================

      case "documentation":

        result =
          evaluateDocumentationFinding(
            flag,
            appeal
          );

        break;


      // ============================================
      // MISSING DIAGNOSIS / CONTEXT
      // ============================================

      case "missing_context":

        result =
          evaluateMissingContextFinding(
            flag,
            appeal
          );

        break;


      // ============================================
      // UNKNOWN RULE TYPE
      // ============================================

      default:

        result = {

          originalFindingType:
            flag.type ||
            "unknown",

          lineCode:
            flag.lineCode ||
            "",

          outcome:
            "not_resolved",

          originalMessage:
            flag.message ||
            "",

          message:
            "This deterministic finding type does not yet have an appeal-resolution rule.",

          evidence:
            "The original finding remains pending because it could not be deterministically reevaluated.",

          detectedBy:
            ["rules"]

        };

        break;

    }


    results.push(
      result
    );

  }


  // ------------------------------------------------
  // Calculate overall deterministic appeal outcome.
  // ------------------------------------------------

  const outcome =
    deriveOverallOutcome(
      results
    );


  return {

    available:
      true,

    outcome,

    results

  };

}


// ==================================================
// DUPLICATE APPEAL CHECK
// ==================================================

function evaluateDuplicateFinding(
  flag,
  lineItems
) {

  const lineCode =
    String(
      flag.lineCode ||
      ""
    ).trim();


  const matchingItems =
    lineItems.filter(
      (item) =>
        String(
          item.code ||
          ""
        ).trim() ===
        lineCode
    );


  // ------------------------------------------------
  // If the appealed corrected bill no longer contains
  // this code, the originally duplicated service has
  // effectively been removed from the appealed data.
  // ------------------------------------------------

  if (
    matchingItems.length === 0
  ) {

    return {

      originalFindingType:
        "duplicate",

      lineCode,

      outcome:
        "resolved",

      originalMessage:
        flag.message ||
        "",

      message:
        `The appealed billing data no longer contains code ${lineCode}, so the duplicate condition is no longer present.`,

      evidence:
        `No ${lineCode} line appears in the appealed corrected billing data.`,

      detectedBy:
        ["rules"]

    };

  }


  // ------------------------------------------------
  // Look for repeated code + service date pairs,
  // matching analyzer.js behavior.
  // ------------------------------------------------

  const seen =
    new Set();

  const duplicateKeys =
    new Set();


  for (
    const item
    of matchingItems
  ) {

    const code =
      String(
        item.code ||
        ""
      ).trim();

    const serviceDate =
      String(
        item.serviceDate ||
        ""
      ).trim();

    const key =
      `${code}|${serviceDate}`;


    if (
      seen.has(key)
    ) {

      duplicateKeys.add(
        key
      );

    }


    seen.add(
      key
    );

  }


  // ------------------------------------------------
  // Duplicate still exists.
  // ------------------------------------------------

  if (
    duplicateKeys.size > 0
  ) {

    return {

      originalFindingType:
        "duplicate",

      lineCode,

      outcome:
        "not_resolved",

      originalMessage:
        flag.message ||
        "",

      message:
        `The appealed billing data still contains a duplicate ${lineCode} service on the same service date.`,

      evidence:
        `${duplicateKeys.size} duplicate code/date combination(s) remain in the appealed data.`,

      detectedBy:
        ["rules"]

    };

  }


  // ------------------------------------------------
  // Code remains, but no duplicate code/date pair.
  // ------------------------------------------------

  return {

    originalFindingType:
      "duplicate",

    lineCode,

    outcome:
      "resolved",

    originalMessage:
      flag.message ||
      "",

    message:
      `The appealed billing data no longer contains the duplicate condition that triggered the original ${lineCode} finding.`,

    evidence:
      `${matchingItems.length} appealed ${lineCode} line(s) were reviewed and no repeated code/service-date pair remains.`,

    detectedBy:
      ["rules"]

  };

}


// ==================================================
// QUANTITY APPEAL CHECK
// ==================================================

function evaluateQuantityFinding(
  flag,
  lineItems
) {

  const lineCode =
    String(
      flag.lineCode ||
      ""
    ).trim();


  const matchingItems =
    lineItems.filter(
      (item) =>
        String(
          item.code ||
          ""
        ).trim() ===
        lineCode
    );


  // ------------------------------------------------
  // Code removed from corrected appeal data.
  // ------------------------------------------------

  if (
    matchingItems.length === 0
  ) {

    return {

      originalFindingType:
        "quantity",

      lineCode,

      outcome:
        "resolved",

      originalMessage:
        flag.message ||
        "",

      message:
        `The appealed billing data no longer contains the ${lineCode} line that triggered the high-unit finding.`,

      evidence:
        `No ${lineCode} line appears in the appealed corrected billing data.`,

      detectedBy:
        ["rules"]

    };

  }


  const unitValues =
    matchingItems.map(
      (item) =>
        Number(
          item.units ||
          1
        )
    );


  const stillFlagged =
    unitValues.filter(
      (units) =>
        units >= 5
    );


  // ------------------------------------------------
  // Every matching line is now below the original
  // analyzer.js threshold.
  // ------------------------------------------------

  if (
    stillFlagged.length === 0
  ) {

    return {

      originalFindingType:
        "quantity",

      lineCode,

      outcome:
        "resolved",

      originalMessage:
        flag.message ||
        "",

      message:
        `The appealed unit count for ${lineCode} is now below the deterministic high-quantity threshold.`,

      evidence:
        `Appealed unit value(s): ${unitValues.join(", ")}. The rule triggers at 5 or more units.`,

      detectedBy:
        ["rules"]

    };

  }


  // ------------------------------------------------
  // Some corrected lines are okay, but another
  // matching line still triggers the quantity rule.
  // ------------------------------------------------

  if (
    stillFlagged.length <
    unitValues.length
  ) {

    return {

      originalFindingType:
        "quantity",

      lineCode,

      outcome:
        "partially_resolved",

      originalMessage:
        flag.message ||
        "",

      message:
        `The appeal corrected some ${lineCode} unit values, but at least one appealed line still meets the high-quantity threshold.`,

      evidence:
        `Appealed unit value(s): ${unitValues.join(", ")}. ${stillFlagged.length} line(s) remain at 5 or more units.`,

      detectedBy:
        ["rules"]

    };

  }


  // ------------------------------------------------
  // All matching lines still trigger the rule.
  // ------------------------------------------------

  return {

    originalFindingType:
      "quantity",

    lineCode,

    outcome:
      "not_resolved",

    originalMessage:
      flag.message ||
      "",

    message:
      `The appealed unit count for ${lineCode} still meets the deterministic high-quantity threshold.`,

    evidence:
      `Appealed unit value(s): ${unitValues.join(", ")}. The rule triggers at 5 or more units.`,

    detectedBy:
      ["rules"]

  };

}


// ==================================================
// PRICE OUTLIER APPEAL CHECK
// ==================================================

function evaluatePriceFinding(
  flag,
  lineItems
) {

  const lineCode =
    String(
      flag.lineCode ||
      ""
    ).trim();


  const referencePrice =
    REFERENCE_PRICES[
      lineCode
    ];


  // ------------------------------------------------
  // We should normally have the same reference value
  // because the original price rule could only fire
  // for supported demo codes.
  // ------------------------------------------------

  if (
    !referencePrice
  ) {

    return {

      originalFindingType:
        "price_outlier",

      lineCode,

      outcome:
        "not_resolved",

      originalMessage:
        flag.message ||
        "",

      message:
        `The appeal price for ${lineCode} could not be deterministically reevaluated because no demo reference price is configured.`,

      evidence:
        "No deterministic appeal comparison was available for this code.",

      detectedBy:
        ["rules"]

    };

  }


  const matchingItems =
    lineItems.filter(
      (item) =>
        String(
          item.code ||
          ""
        ).trim() ===
        lineCode
    );


  // ------------------------------------------------
  // Removed service.
  // ------------------------------------------------

  if (
    matchingItems.length === 0
  ) {

    return {

      originalFindingType:
        "price_outlier",

      lineCode,

      outcome:
        "resolved",

      originalMessage:
        flag.message ||
        "",

      message:
        `The appealed billing data no longer contains the ${lineCode} line that triggered the original price-outlier finding.`,

      evidence:
        `No ${lineCode} line appears in the appealed corrected billing data.`,

      detectedBy:
        ["rules"]

    };

  }


  const amounts =
    matchingItems.map(
      (item) =>
        Number(
          item.amount ||
          0
        )
    );


  const threshold =
    referencePrice *
    2.5;


  const stillFlagged =
    amounts.filter(
      (amount) =>
        amount >
        threshold
    );


  // ------------------------------------------------
  // All corrected amounts fall below the same
  // threshold used by analyzer.js.
  // ------------------------------------------------

  if (
    stillFlagged.length === 0
  ) {

    return {

      originalFindingType:
        "price_outlier",

      lineCode,

      outcome:
        "resolved",

      originalMessage:
        flag.message ||
        "",

      message:
        `The appealed amount for ${lineCode} no longer exceeds the deterministic price-outlier threshold.`,

      evidence:
        `Appealed amount(s): ${formatMoneyList(amounts)}. Demo reference: $${referencePrice.toFixed(2)}; outlier threshold: above $${threshold.toFixed(2)}.`,

      detectedBy:
        ["rules"]

    };

  }


  // ------------------------------------------------
  // Mixed corrected/unresolved price lines.
  // ------------------------------------------------

  if (
    stillFlagged.length <
    amounts.length
  ) {

    return {

      originalFindingType:
        "price_outlier",

      lineCode,

      outcome:
        "partially_resolved",

      originalMessage:
        flag.message ||
        "",

      message:
        `The appeal corrected some ${lineCode} billed amounts, but at least one appealed amount still exceeds the deterministic price-outlier threshold.`,

      evidence:
        `Appealed amount(s): ${formatMoneyList(amounts)}. Demo reference: $${referencePrice.toFixed(2)}; outlier threshold: above $${threshold.toFixed(2)}.`,

      detectedBy:
        ["rules"]

    };

  }


  // ------------------------------------------------
  // Price problem remains.
  // ------------------------------------------------

  return {

    originalFindingType:
      "price_outlier",

    lineCode,

    outcome:
      "not_resolved",

    originalMessage:
      flag.message ||
      "",

    message:
      `The appealed amount for ${lineCode} still exceeds the deterministic price-outlier threshold.`,

    evidence:
      `Appealed amount(s): ${formatMoneyList(amounts)}. Demo reference: $${referencePrice.toFixed(2)}; outlier threshold: above $${threshold.toFixed(2)}.`,

    detectedBy:
      ["rules"]

  };

}


// ==================================================
// DOCUMENTATION APPEAL CHECK
// ==================================================

function evaluateDocumentationFinding(
  flag,
  appeal
) {

  const lineCode =
    String(
      flag.lineCode ||
      ""
    ).trim();


  // ------------------------------------------------
  // The appeal may eventually provide documentation
  // through several frontend fields.
  //
  // Combine them for the deterministic "is additional
  // documentation present?" screening check.
  // ------------------------------------------------

  const clinicalNote =
    String(
      appeal?.clinicalNote ||
      ""
    ).trim();


  const appealNote =
    String(
      appeal?.appealNote ||
      ""
    ).trim();


  const supportingEvidence =
    String(
      appeal?.supportingEvidence ||
      ""
    ).trim();


  const combinedDocumentation =
    [
      clinicalNote,
      appealNote,
      supportingEvidence
    ]
      .filter(Boolean)
      .join(" ")
      .trim();


  const documentationLength =
    combinedDocumentation.length;


  // ------------------------------------------------
  // IMPORTANT:
  //
  // The deterministic rule can only evaluate whether
  // the original "very limited documentation" signal
  // has been addressed structurally.
  //
  // It does NOT decide whether the documentation
  // medically supports the service.
  //
  // AI will separately review actual evidentiary
  // relevance.
  // ------------------------------------------------

  if (
    documentationLength === 0
  ) {

    return {

      originalFindingType:
        "documentation",

      lineCode,

      outcome:
        "not_resolved",

      originalMessage:
        flag.message ||
        "",

      message:
        `The appeal did not provide additional documentation to address the original ${lineCode} documentation finding.`,

      evidence:
        "No appeal note, clinical note, or supporting evidence text was supplied.",

      detectedBy:
        ["rules"]

    };

  }


  // ------------------------------------------------
  // Same structural threshold as analyzer.js.
  // ------------------------------------------------

  if (
    HIGH_INTENSITY_CODES.has(
      lineCode
    ) &&
    documentationLength <
      90
  ) {

    return {

      originalFindingType:
        "documentation",

      lineCode,

      outcome:
        "partially_resolved",

      originalMessage:
        flag.message ||
        "",

      message:
        `The appeal supplied additional documentation for ${lineCode}, but the deterministic limited-documentation signal is not fully cleared.`,

      evidence:
        `Combined appeal documentation is ${documentationLength} characters long. The original screening rule flags documentation under 90 characters for this demo high-intensity code.`,

      detectedBy:
        ["rules"]

    };

  }


  return {

    originalFindingType:
      "documentation",

    lineCode,

    outcome:
      "resolved",

    originalMessage:
      flag.message ||
      "",

    message:
      `The appeal supplied enough additional documentation to clear the original deterministic limited-documentation signal for ${lineCode}.`,

    evidence:
      `Combined appeal documentation is ${documentationLength} characters long. This only clears the structural screening rule; evidentiary relevance is reviewed separately by AI.`,

    detectedBy:
      ["rules"]

  };

}


// ==================================================
// MISSING CONTEXT / DIAGNOSIS CHECK
// ==================================================

function evaluateMissingContextFinding(
  flag,
  appeal
) {

  const diagnosisCodes =
    normalizeDiagnosisCodes(
      appeal?.diagnosisCodes
    );


  if (
    diagnosisCodes.length >
    0
  ) {

    return {

      originalFindingType:
        "missing_context",

      lineCode:
        flag.lineCode ||
        "",

      outcome:
        "resolved",

      originalMessage:
        flag.message ||
        "",

      message:
        "The appeal supplied diagnosis context that was missing from the original claim.",

      evidence:
        `Appeal diagnosis code(s): ${diagnosisCodes.join(", ")}.`,

      detectedBy:
        ["rules"]

    };

  }


  return {

    originalFindingType:
      "missing_context",

    lineCode:
      flag.lineCode ||
      "",

    outcome:
      "not_resolved",

    originalMessage:
      flag.message ||
      "",

    message:
      "The appeal did not supply diagnosis context to address the original missing-context finding.",

    evidence:
      "No diagnosis codes were supplied with the appeal.",

    detectedBy:
      ["rules"]

  };

}


// ==================================================
// OVERALL RULES OUTCOME
// ==================================================

function deriveOverallOutcome(
  results
) {

  // ------------------------------------------------
  // No deterministic findings means there was
  // nothing for the rule appeal analyzer to resolve.
  //
  // We return "resolved" from the RULES perspective.
  // AI may still have original findings to evaluate.
  // ------------------------------------------------

  if (
    results.length === 0
  ) {

    return "resolved";

  }


  const outcomes =
    results.map(
      (result) =>
        result.outcome
    );


  // ------------------------------------------------
  // Everything resolved.
  // ------------------------------------------------

  if (
    outcomes.every(
      (outcome) =>
        outcome ===
        "resolved"
    )
  ) {

    return "resolved";

  }


  // ------------------------------------------------
  // Nothing was resolved at all.
  // ------------------------------------------------

  if (
    outcomes.every(
      (outcome) =>
        outcome ===
        "not_resolved"
    )
  ) {

    return "not_resolved";

  }


  // ------------------------------------------------
  // Any mixture means some progress was made but
  // the original deterministic concerns are not all
  // cleared.
  //
  // This includes:
  //
  // resolved + not_resolved
  // resolved + partially_resolved
  // partially_resolved + not_resolved
  // all partially_resolved
  // ------------------------------------------------

  return "partially_resolved";

}


// ==================================================
// DIAGNOSIS NORMALIZATION
// ==================================================

function normalizeDiagnosisCodes(
  value
) {

  if (
    Array.isArray(value)
  ) {

    return value
      .map(
        (code) =>
          String(
            code ||
            ""
          ).trim()
      )
      .filter(Boolean);

  }


  if (
    typeof value ===
    "string"
  ) {

    return value
      .split(/[;,|]/)
      .map(
        (code) =>
          code.trim()
      )
      .filter(Boolean);

  }


  return [];

}


// ==================================================
// MONEY LIST FORMATTER
// ==================================================

function formatMoneyList(
  values
) {

  return values
    .map(
      (value) =>
        `$${Number(value || 0).toFixed(2)}`
    )
    .join(", ");

}