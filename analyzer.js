// =============================================
// Reference prices used by deterministic rules
// =============================================

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



// =============================================
// Higher-intensity procedure codes
// =============================================

const HIGH_INTENSITY_CODES =
  new Set([
    "99215",
    "74177"
  ]);



// =============================================
// Main deterministic analyzer
// =============================================

export function analyzeClaim(
  claim
) {

  const flags =
    [];


  let score =
    0;



  // =============================================
  // Track UNIQUE claim lines under review.
  //
  // A line may trigger multiple findings, but its
  // billed amount should only count once toward
  // reviewAmount.
  // =============================================

  const reviewedLineIndexes =
    new Set();



  // =============================================
  // Total billed amount
  // =============================================

  const totalBilled =

    claim.lineItems.reduce(

      (total, item) =>

        total +
        Number(
          item.amount || 0
        ),

      0

    );



  // =============================================
  // Rule 1:
  // Duplicate procedure code on same date
  // =============================================

  const procedureDateMap =
    new Map();


  claim.lineItems.forEach(
    (item, index) => {

      const key =
        `${item.code}|${item.serviceDate}`;


      if (
        !procedureDateMap.has(
          key
        )
      ) {

        procedureDateMap.set(
          key,
          []
        );

      }


      procedureDateMap
        .get(key)
        .push({
          item,
          index
        });

    }
  );



  for (
    const entries
    of procedureDateMap.values()
  ) {

    if (
      entries.length > 1
    ) {

      const first =
        entries[0].item;


      score +=
        28;



      // -----------------------------------------
      // Only the extra duplicate entries are
      // considered duplicate dollars.
      //
      // Mark those lines for review.
      // -----------------------------------------

      entries
        .slice(1)
        .forEach(
          (entry) => {

            reviewedLineIndexes.add(
              entry.index
            );

          }
        );


      flags.push({

        type:
          "duplicate",

        severity:
          "high",

        lineCode:
          first.code,

        message:
          `Procedure ${first.code} appears more than once on the same service date.`,

        evidence:
          `${entries.length} entries for procedure ${first.code} were billed on ${first.serviceDate}.`,

        detectedBy:
          ["rules"]

      });

    }

  }



  // =============================================
  // Rule 2:
  // Unusually high units
  // =============================================

  claim.lineItems.forEach(
    (item, index) => {

      const units =
        Number(
          item.units || 1
        );


      if (
        units >= 5
      ) {

        score +=
          22;


        reviewedLineIndexes.add(
          index
        );


        flags.push({

          type:
            "quantity",

          severity:
            "medium",

          lineCode:
            item.code,

          message:
            `Procedure ${item.code} has an unusually high unit count.`,

          evidence:
            `${units} units were billed for procedure ${item.code}.`,

          detectedBy:
            ["rules"]

        });

      }

    }
  );



  // =============================================
  // Rule 3:
  // Price outlier
  // More than 2.5× reference price
  // =============================================

  claim.lineItems.forEach(
    (item, index) => {

      const referencePrice =
        REFERENCE_PRICES[
          item.code
        ];


      if (
        !referencePrice
      ) {

        return;

      }


      const billedAmount =
        Number(
          item.amount || 0
        );


      const ratio =
        billedAmount /
        referencePrice;


      if (
        ratio > 2.5
      ) {

        score +=
          25;


        reviewedLineIndexes.add(
          index
        );


        flags.push({

          type:
            "price_outlier",

          severity:
            "medium",

          lineCode:
            item.code,

          message:
            `Procedure ${item.code} is billed well above the reference amount.`,

          evidence:
            `Billed amount is $${billedAmount.toFixed(
              2
            )} compared with a reference amount of $${referencePrice.toFixed(
              2
            )}.`,

          detectedBy:
            ["rules"]

        });

      }

    }
  );



  // =============================================
  // Rule 4:
  // Limited documentation for higher-intensity
  // procedures
  // =============================================

  const clinicalNote =

    String(
      claim.clinicalNote || ""
    )
      .trim();


  claim.lineItems.forEach(
    (item, index) => {

      if (
        HIGH_INTENSITY_CODES.has(
          item.code
        ) &&
        clinicalNote.length > 0 &&
        clinicalNote.length < 90
      ) {

        score +=
          18;


        reviewedLineIndexes.add(
          index
        );


        flags.push({

          type:
            "documentation",

          severity:
            "medium",

          lineCode:
            item.code,

          message:
            `Documentation may be limited for higher-intensity procedure ${item.code}.`,

          evidence:
            `The supplied clinical note is ${clinicalNote.length} characters long.`,

          detectedBy:
            ["rules"]

        });

      }

    }
  );



  // =============================================
  // Rule 5:
  // Missing diagnosis context
  //
  // This is a claim-level finding, not tied to
  // one specific billed line, so it does not add
  // anything to reviewAmount.
  // =============================================

  const diagnosisCodes =

    Array.isArray(
      claim.diagnosisCodes
    )

      ? claim.diagnosisCodes

      : [];


  if (
    diagnosisCodes.length === 0
  ) {

    score +=
      15;


    flags.push({

      type:
        "missing_context",

      severity:
        "medium",

      lineCode:
        null,

      message:
        "Diagnosis context is missing.",

      evidence:
        "No diagnosis codes were supplied with the claim.",

      detectedBy:
        ["rules"]

    });

  }



  // =============================================
  // Calculate UNIQUE review amount
  //
  // Each flagged line contributes its amount only
  // once, even if it has several findings.
  // =============================================

  const reviewAmount =

    [...reviewedLineIndexes]
      .reduce(

        (total, index) => {

          const item =
            claim.lineItems[
              index
            ];


          return (
            total +
            Number(
              item?.amount || 0
            )
          );

        },

        0

      );



  // =============================================
  // Prevent score from exceeding 100
  // =============================================

  score =
    Math.min(
      score,
      100
    );



  // =============================================
  // Overall deterministic risk level
  //
  // Highest deterministic finding wins.
  // =============================================

  const hasHighFinding =

    flags.some(
      (flag) =>
        flag.severity ===
        "high"
    );


  const hasMediumFinding =

    flags.some(
      (flag) =>
        flag.severity ===
        "medium"
    );


  const riskLevel =

    hasHighFinding

      ? "high"

      : hasMediumFinding

        ? "review"

        : "low";



  // =============================================
  // Return deterministic analysis
  // =============================================

  return {

    totalBilled,

    riskScore:
      score,

    reviewAmount,

    riskLevel,

    flags

  };

}