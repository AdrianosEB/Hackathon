// ==================================================
// ORCHESTRATION EXAMPLES
//
// Synthetic claims and appeals, one scenario per
// deterministic rule, plus one scenario that trips
// several rules at once.
//
// Every scenario names the deterministic outcome it
// is built to produce, so examples/run-orchestration.js
// can check the pipeline end to end without needing
// an OpenAI key.
//
// All data here is invented for a hackathon demo. No
// real patient, provider, or reimbursement rate is
// represented.
// ==================================================


const LONG_NOTE =
  "Patient presented with persistent cough and low-grade fever for eight days. " +
  "Lungs clear on auscultation, no acute distress, vitals stable. " +
  "Discussed supportive care, return precautions, and follow-up in two weeks.";


const SHORT_NOTE =
  "Seen for follow-up. Doing okay.";


export const SCENARIOS = [


  // ================================================
  // 1. CLEAN CLAIM
  //
  // No rule fires. Nothing for a human to look at.
  // ================================================

  {

    name:
      "clean claim",

    expects: {

      rulesRiskLevel:
        "low",

      flagTypes:
        [],

      nextStep:
        "auto_clear"

    },

    claim: {

      claimNumber:
        "CLM-1001",

      providerName:
        "Northside Family Medicine",

      patientLabel:
        "Patient A",

      diagnosisCodes:
        ["J06.9"],

      clinicalNote:
        LONG_NOTE,

      lineItems: [

        {
          code: "99213",
          description: "Office visit, established patient",
          serviceDate: "2026-03-02",
          units: 1,
          amount: 110
        }

      ]

    },

    appeals:
      []

  },


  // ================================================
  // 2. DUPLICATE SERVICE
  //
  // Same code, same service date, twice.
  // The only rule that produces a HIGH severity.
  // ================================================

  {

    name:
      "duplicate service",

    expects: {

      rulesRiskLevel:
        "high",

      flagTypes:
        ["duplicate"],

      nextStep:
        "priority_human_review"

    },

    claim: {

      claimNumber:
        "CLM-1002",

      providerName:
        "Lakeview Internal Medicine",

      patientLabel:
        "Patient B",

      diagnosisCodes:
        ["E11.9"],

      clinicalNote:
        LONG_NOTE,

      lineItems: [

        {
          code: "99214",
          description: "Office visit, moderate complexity",
          serviceDate: "2026-03-04",
          units: 1,
          amount: 165
        },

        {
          code: "99214",
          description: "Office visit, moderate complexity",
          serviceDate: "2026-03-04",
          units: 1,
          amount: 165
        }

      ]

    },

    appeals: [

      {

        name:
          "duplicate line removed",

        expects: {

          rulesOutcome:
            "resolved",

          nextStep:
            "close_appeal"

        },

        appeal: {

          claimNumber:
            "CLM-1002",

          appealReason:
            "Billing correction",

          appealNote:
            "The second 99214 line was a submission error and has been removed from the corrected billing data.",

          supportingEvidence:
            "Corrected claim contains a single office visit for 2026-03-04.",

          diagnosisCodes:
            ["E11.9"],

          clinicalNote:
            LONG_NOTE,

          lineItems: [

            {
              code: "99214",
              description: "Office visit, moderate complexity",
              serviceDate: "2026-03-04",
              units: 1,
              amount: 165
            }

          ]

        }

      },


      {

        name:
          "disagreement only, nothing corrected",

        expects: {

          rulesOutcome:
            "not_resolved",

          nextStep:
            "human_review_unresolved"

        },

        appeal: {

          claimNumber:
            "CLM-1002",

          appealReason:
            "Provider disagrees with the finding",

          appealNote:
            "Both visits were medically appropriate and we do not believe this is a duplicate.",

          supportingEvidence:
            "",

          diagnosisCodes:
            ["E11.9"],

          clinicalNote:
            LONG_NOTE,

          lineItems: [

            {
              code: "99214",
              description: "Office visit, moderate complexity",
              serviceDate: "2026-03-04",
              units: 1,
              amount: 165
            },

            {
              code: "99214",
              description: "Office visit, moderate complexity",
              serviceDate: "2026-03-04",
              units: 1,
              amount: 165
            }

          ]

        }

      }

    ]

  },


  // ================================================
  // 3. HIGH UNIT COUNT
  //
  // Also shows the only rule with a natural
  // partially_resolved appeal state: several lines
  // share a code and only some are corrected.
  // ================================================

  {

    name:
      "high unit count",

    expects: {

      rulesRiskLevel:
        "review",

      flagTypes:
        ["quantity"],

      nextStep:
        "human_review"

    },

    claim: {

      claimNumber:
        "CLM-1003",

      providerName:
        "Harbor Point Labs",

      patientLabel:
        "Patient C",

      diagnosisCodes:
        ["D64.9"],

      clinicalNote:
        LONG_NOTE,

      lineItems: [

        {
          code: "36415",
          description: "Routine venipuncture",
          serviceDate: "2026-03-06",
          units: 8,
          amount: 96
        }

      ]

    },

    appeals: [

      {

        name:
          "units corrected",

        expects: {

          rulesOutcome:
            "resolved",

          nextStep:
            "close_appeal"

        },

        appeal: {

          claimNumber:
            "CLM-1003",

          appealReason:
            "Units corrected",

          appealNote:
            "The unit count was entered incorrectly. Two draws were performed, not eight.",

          supportingEvidence:
            "Corrected billing shows two units for 2026-03-06.",

          diagnosisCodes:
            ["D64.9"],

          clinicalNote:
            LONG_NOTE,

          lineItems: [

            {
              code: "36415",
              description: "Routine venipuncture",
              serviceDate: "2026-03-06",
              units: 2,
              amount: 24
            }

          ]

        }

      },


      {

        name:
          "one line corrected, one still high",

        expects: {

          rulesOutcome:
            "partially_resolved",

          nextStep:
            "human_review_remaining"

        },

        appeal: {

          claimNumber:
            "CLM-1003",

          appealReason:
            "Partial units correction",

          appealNote:
            "One of the two draws has been corrected. The second is still under internal review.",

          supportingEvidence:
            "Corrected billing shows two units on 2026-03-06 and six units on 2026-03-07.",

          diagnosisCodes:
            ["D64.9"],

          clinicalNote:
            LONG_NOTE,

          lineItems: [

            {
              code: "36415",
              description: "Routine venipuncture",
              serviceDate: "2026-03-06",
              units: 2,
              amount: 24
            },

            {
              code: "36415",
              description: "Routine venipuncture",
              serviceDate: "2026-03-07",
              units: 6,
              amount: 72
            }

          ]

        }

      }

    ]

  },


  // ================================================
  // 4. PRICE OUTLIER
  //
  // 93000 reference is 50, so the rule fires above
  // 125 and clears at or below it.
  // ================================================

  {

    name:
      "price outlier",

    expects: {

      rulesRiskLevel:
        "review",

      flagTypes:
        ["price_outlier"],

      nextStep:
        "human_review"

    },

    claim: {

      claimNumber:
        "CLM-1004",

      providerName:
        "Cedar Grove Cardiology",

      patientLabel:
        "Patient D",

      diagnosisCodes:
        ["R00.2"],

      clinicalNote:
        LONG_NOTE,

      lineItems: [

        {
          code: "93000",
          description: "Electrocardiogram, complete",
          serviceDate: "2026-03-09",
          units: 1,
          amount: 400
        }

      ]

    },

    appeals: [

      {

        name:
          "amount corrected",

        expects: {

          rulesOutcome:
            "resolved",

          nextStep:
            "close_appeal"

        },

        appeal: {

          claimNumber:
            "CLM-1004",

          appealReason:
            "Pricing correction",

          appealNote:
            "The billed amount reflected an outdated fee entry and has been corrected.",

          supportingEvidence:
            "Corrected billing shows $60.00 for 93000 on 2026-03-09.",

          diagnosisCodes:
            ["R00.2"],

          clinicalNote:
            LONG_NOTE,

          lineItems: [

            {
              code: "93000",
              description: "Electrocardiogram, complete",
              serviceDate: "2026-03-09",
              units: 1,
              amount: 60
            }

          ]

        }

      },


      {

        name:
          "amount unchanged",

        expects: {

          rulesOutcome:
            "not_resolved",

          nextStep:
            "human_review_unresolved"

        },

        appeal: {

          claimNumber:
            "CLM-1004",

          appealReason:
            "Provider maintains the billed amount",

          appealNote:
            "Our contracted rate for this service is higher than the reference amount used.",

          supportingEvidence:
            "",

          diagnosisCodes:
            ["R00.2"],

          clinicalNote:
            LONG_NOTE,

          lineItems: [

            {
              code: "93000",
              description: "Electrocardiogram, complete",
              serviceDate: "2026-03-09",
              units: 1,
              amount: 400
            }

          ]

        }

      }

    ]

  },


  // ================================================
  // 5. LIMITED DOCUMENTATION
  //
  // 99215 is a high-intensity demo code, so a note
  // shorter than 90 characters is flagged.
  //
  // On appeal the deterministic check only measures
  // whether MORE text arrived. Whether that text is
  // evidentiarily relevant is the AI reviewer's job.
  // ================================================

  {

    name:
      "limited documentation",

    expects: {

      rulesRiskLevel:
        "review",

      flagTypes:
        ["documentation"],

      nextStep:
        "human_review"

    },

    claim: {

      claimNumber:
        "CLM-1005",

      providerName:
        "Riverbend Specialty Clinic",

      patientLabel:
        "Patient E",

      diagnosisCodes:
        ["I10"],

      clinicalNote:
        SHORT_NOTE,

      lineItems: [

        {
          code: "99215",
          description: "Office visit, high complexity",
          serviceDate: "2026-03-11",
          units: 1,
          amount: 230
        }

      ]

    },

    appeals: [

      {

        name:
          "full documentation supplied",

        expects: {

          rulesOutcome:
            "resolved",

          nextStep:
            "close_appeal"

        },

        appeal: {

          claimNumber:
            "CLM-1005",

          appealReason:
            "Additional documentation",

          appealNote:
            "Attaching the full encounter note that was omitted from the original submission.",

          supportingEvidence:
            LONG_NOTE,

          diagnosisCodes:
            ["I10"],

          clinicalNote:
            LONG_NOTE,

          lineItems: [

            {
              code: "99215",
              description: "Office visit, high complexity",
              serviceDate: "2026-03-11",
              units: 1,
              amount: 230
            }

          ]

        }

      },


      {

        name:
          "a little more text, still thin",

        expects: {

          rulesOutcome:
            "partially_resolved",

          nextStep:
            "human_review_remaining"

        },

        appeal: {

          claimNumber:
            "CLM-1005",

          appealReason:
            "Additional documentation",

          appealNote:
            "Visit was complex.",

          supportingEvidence:
            "",

          diagnosisCodes:
            ["I10"],

          clinicalNote:
            "",

          lineItems: [

            {
              code: "99215",
              description: "Office visit, high complexity",
              serviceDate: "2026-03-11",
              units: 1,
              amount: 230
            }

          ]

        }

      }

    ]

  },


  // ================================================
  // 6. MISSING DIAGNOSIS CONTEXT
  //
  // A claim-level finding. It carries no billed
  // amount, so it raises risk without raising
  // reviewAmount.
  // ================================================

  {

    name:
      "missing diagnosis context",

    expects: {

      rulesRiskLevel:
        "review",

      flagTypes:
        ["missing_context"],

      nextStep:
        "human_review"

    },

    claim: {

      claimNumber:
        "CLM-1006",

      providerName:
        "Westgate Urgent Care",

      patientLabel:
        "Patient F",

      diagnosisCodes:
        [],

      clinicalNote:
        LONG_NOTE,

      lineItems: [

        {
          code: "99213",
          description: "Office visit, established patient",
          serviceDate: "2026-03-13",
          units: 1,
          amount: 110
        }

      ]

    },

    appeals: [

      {

        name:
          "diagnosis supplied",

        expects: {

          rulesOutcome:
            "resolved",

          nextStep:
            "close_appeal"

        },

        appeal: {

          claimNumber:
            "CLM-1006",

          appealReason:
            "Missing data supplied",

          appealNote:
            "The diagnosis code was dropped by our clearinghouse and is supplied here.",

          supportingEvidence:
            "Encounter diagnosis: J06.9.",

          diagnosisCodes:
            ["J06.9"],

          clinicalNote:
            LONG_NOTE,

          lineItems: [

            {
              code: "99213",
              description: "Office visit, established patient",
              serviceDate: "2026-03-13",
              units: 1,
              amount: 110
            }

          ]

        }

      }

    ]

  },


  // ================================================
  // 7. SEVERAL FINDINGS AT ONCE
  //
  // Shows the part that matters most in the appeal
  // stage: an appeal that fixes three of four
  // findings is NOT a resolved appeal.
  // ================================================

  {

    name:
      "several findings at once",

    expects: {

      rulesRiskLevel:
        "high",

      flagTypes:
        ["duplicate", "quantity", "price_outlier", "missing_context"],

      nextStep:
        "priority_human_review"

    },

    claim: {

      claimNumber:
        "CLM-1007",

      providerName:
        "Summit Multispecialty Group",

      patientLabel:
        "Patient G",

      diagnosisCodes:
        [],

      clinicalNote:
        LONG_NOTE,

      lineItems: [

        {
          code: "99214",
          description: "Office visit, moderate complexity",
          serviceDate: "2026-03-16",
          units: 1,
          amount: 165
        },

        {
          code: "99214",
          description: "Office visit, moderate complexity",
          serviceDate: "2026-03-16",
          units: 1,
          amount: 165
        },

        {
          code: "36415",
          description: "Routine venipuncture",
          serviceDate: "2026-03-16",
          units: 7,
          amount: 84
        },

        {
          code: "93000",
          description: "Electrocardiogram, complete",
          serviceDate: "2026-03-16",
          units: 1,
          amount: 380
        }

      ]

    },

    appeals: [

      {

        name:
          "three of four findings corrected",

        expects: {

          rulesOutcome:
            "partially_resolved",

          nextStep:
            "human_review_remaining"

        },

        appeal: {

          claimNumber:
            "CLM-1007",

          appealReason:
            "Partial billing correction",

          appealNote:
            "Duplicate visit removed, unit count corrected, and diagnosis context supplied. The ECG amount is still being reviewed internally.",

          supportingEvidence:
            "Corrected billing data attached for 2026-03-16.",

          diagnosisCodes:
            ["I10"],

          clinicalNote:
            LONG_NOTE,

          lineItems: [

            {
              code: "99214",
              description: "Office visit, moderate complexity",
              serviceDate: "2026-03-16",
              units: 1,
              amount: 165
            },

            {
              code: "36415",
              description: "Routine venipuncture",
              serviceDate: "2026-03-16",
              units: 2,
              amount: 24
            },

            {
              code: "93000",
              description: "Electrocardiogram, complete",
              serviceDate: "2026-03-16",
              units: 1,
              amount: 380
            }

          ]

        }

      }

    ]

  }

];
