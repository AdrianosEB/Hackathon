import OpenAI from "openai";


// =============================================
// OpenAI configuration
// =============================================

const apiKey =
  process.env.OPENAI_API_KEY;


const model =
  process.env.OPENAI_MODEL ||
  "gpt-5.6-sol";


// =============================================
// Create client only when key exists
//
// This allows deterministic appeal review to keep
// working even if OpenAI is unavailable.
// =============================================

const client =
  apiKey
    ? new OpenAI({
        apiKey
      })
    : null;


// =============================================
// Valid appeal outcomes
// =============================================

const VALID_OUTCOMES =
  new Set([
    "resolved",
    "partially_resolved",
    "not_resolved"
  ]);


// =============================================
// Normalize one appeal outcome
// =============================================

function normalizeOutcome(
  value
) {

  const outcome =
    String(
      value ||
      ""
    )
      .trim()
      .toLowerCase();


  if (
    VALID_OUTCOMES.has(
      outcome
    )
  ) {

    return outcome;

  }


  return "not_resolved";

}


// =============================================
// Build compact original claim payload
// =============================================

function buildOriginalClaimForAI(
  claim
) {

  return {

    claimNumber:
      claim?.claimNumber ||
      "",

    providerName:
      claim?.providerName ||
      "",

    patientLabel:
      claim?.patientLabel ||
      "",

    diagnosisCodes:
      Array.isArray(
        claim?.diagnosisCodes
      )
        ? claim.diagnosisCodes
        : [],

    clinicalNote:
      claim?.clinicalNote ||
      "",

    lineItems:
      Array.isArray(
        claim?.lineItems
      )
        ? claim.lineItems.map(
            (item) => ({

              code:
                item.code ||
                "",

              description:
                item.description ||
                "",

              serviceDate:
                item.serviceDate ||
                "",

              units:
                Number(
                  item.units ||
                  1
                ),

              amount:
                Number(
                  item.amount ||
                  0
                )

            })
          )
        : []

  };

}


// =============================================
// Build compact original findings payload
// =============================================

function buildOriginalFindingsForAI(
  originalClaim
) {

  const flags =
    Array.isArray(
      originalClaim?.flags
    )
      ? originalClaim.flags
      : [];


  return flags.map(
    (flag, index) => ({

      findingIndex:
        index,

      lineCode:
        flag?.lineCode ||
        "",

      type:
        flag?.type ||
        "unknown",

      severity:
        flag?.severity ||
        "",

      message:
        flag?.message ||
        "",

      evidence:
        flag?.evidence ||
        "",

      detectedBy:
        Array.isArray(
          flag?.detectedBy
        )
          ? flag.detectedBy
          : ["rules"],

      aiReview:
        flag?.aiReview
          ? {
              severity:
                flag.aiReview.severity ||
                "",

              reason:
                flag.aiReview.reason ||
                "",

              message:
                flag.aiReview.message ||
                "",

              evidence:
                flag.aiReview.evidence ||
                ""
            }
          : null

    })
  );

}


// =============================================
// Build appeal payload for AI
// =============================================

function buildAppealForAI(
  appeal
) {

  return {

    claimNumber:
      appeal?.claimNumber ||
      "",

    providerName:
      appeal?.providerName ||
      "",

    appealReason:
      appeal?.appealReason ||
      "",

    appealNote:
      appeal?.appealNote ||
      "",

    supportingEvidence:
      appeal?.supportingEvidence ||
      "",

    diagnosisCodes:
      Array.isArray(
        appeal?.diagnosisCodes
      )
        ? appeal.diagnosisCodes
        : [],

    clinicalNote:
      appeal?.clinicalNote ||
      "",

    lineItems:
      Array.isArray(
        appeal?.lineItems
      )
        ? appeal.lineItems.map(
            (item) => ({

              code:
                item.code ||
                "",

              description:
                item.description ||
                "",

              serviceDate:
                item.serviceDate ||
                "",

              units:
                Number(
                  item.units ||
                  1
                ),

              amount:
                Number(
                  item.amount ||
                  0
                )

            })
          )
        : []

  };

}


// =============================================
// Structured output schema
// =============================================

const APPEAL_REVIEW_SCHEMA = {

  type:
    "object",

  additionalProperties:
    false,

  properties: {

    outcome: {

      type:
        "string",

      enum: [
        "resolved",
        "partially_resolved",
        "not_resolved"
      ]

    },


    summary: {

      type:
        "string"

    },


    results: {

      type:
        "array",

      items: {

        type:
          "object",

        additionalProperties:
          false,

        properties: {

          findingIndex: {

            type:
              "integer",

            minimum:
              0

          },


          lineCode: {

            type:
              "string"

          },


          originalFindingType: {

            type:
              "string"

          },


          originalFinding: {

            type:
              "string"

          },


          outcome: {

            type:
              "string",

            enum: [
              "resolved",
              "partially_resolved",
              "not_resolved"
            ]

          },


          explanation: {

            type:
              "string"

          },


          appealEvidence: {

            type:
              "string"

          }

        },


        required: [
          "findingIndex",
          "lineCode",
          "originalFindingType",
          "originalFinding",
          "outcome",
          "explanation",
          "appealEvidence"
        ]

      }

    }

  },


  required: [
    "outcome",
    "summary",
    "results"
  ]

};


// =============================================
// Normalize one AI appeal result
// =============================================

function normalizeResult(
  result
) {

  if (
    !result ||
    typeof result !==
      "object"
  ) {

    return null;

  }


  const findingIndex =
    Number(
      result.findingIndex
    );


  return {

    findingIndex:
      Number.isInteger(
        findingIndex
      ) &&
      findingIndex >= 0

        ? findingIndex

        : 0,


    lineCode:
      String(
        result.lineCode ||
        ""
      ).trim(),


    originalFindingType:
      String(
        result.originalFindingType ||
        "unknown"
      ).trim(),


    originalFinding:
      String(
        result.originalFinding ||
        ""
      ).trim(),


    outcome:
      normalizeOutcome(
        result.outcome
      ),


    explanation:
      String(
        result.explanation ||
        ""
      ).trim(),


    appealEvidence:
      String(
        result.appealEvidence ||
        ""
      ).trim(),


    detectedBy:
      ["ai"]

  };

}


// =============================================
// Derive overall outcome in code
//
// We do not blindly trust the model's overall label.
// The per-finding outcomes determine the final AI
// appeal result.
//
// RULE:
//
// All resolved
// -> resolved
//
// Nothing resolved
// -> not_resolved
//
// Any meaningful mixture
// -> partially_resolved
// =============================================

function deriveOverallOutcome(
  results
) {

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


  if (
    outcomes.every(
      (outcome) =>
        outcome ===
        "resolved"
    )
  ) {

    return "resolved";

  }


  if (
    outcomes.every(
      (outcome) =>
        outcome ===
        "not_resolved"
    )
  ) {

    return "not_resolved";

  }


  return "partially_resolved";

}


// =============================================
// AI appeal evidence reviewer
// =============================================

export async function reviewAppealWithAI(
  originalClaim,
  appeal
) {

  // =============================================
  // OpenAI unavailable
  // =============================================

  if (
    !client
  ) {

    return {

      available:
        false,

      outcome:
        "unavailable",

      summary:
        "AI appeal evidence review unavailable.",

      results:
        []

    };

  }


  const originalClaimPayload =
    buildOriginalClaimForAI(
      originalClaim
    );


  const originalFindingsPayload =
    buildOriginalFindingsForAI(
      originalClaim
    );


  const appealPayload =
    buildAppealForAI(
      appeal
    );


  // =============================================
  // No original findings
  //
  // Normally appeals will be attached to a claim
  // that had something requiring review.
  //
  // Still handle an empty finding set safely.
  // =============================================

  if (
    originalFindingsPayload.length ===
    0
  ) {

    return {

      available:
        true,

      outcome:
        "resolved",

      summary:
        "The original claim contains no stored findings requiring appeal resolution.",

      results:
        []

    };

  }


  // =============================================
  // Instructions
  //
  // IMPORTANT PRODUCT BOUNDARY:
  //
  // This AI is NOT reconsidering the entire claim.
  //
  // It compares NEW APPEAL EVIDENCE against the
  // ORIGINAL FINDINGS.
  // =============================================

  const instructions = `
You are an appeal evidence-review assistant for a synthetic medical billing hackathon demo.

You are helping a HUMAN CLAIM REVIEWER evaluate whether a provider's NEW APPEAL INFORMATION addresses concerns that were identified during an EARLIER CLAIM REVIEW.

IMPORTANT:

You are NOT reviewing the appeal from scratch.

You are NOT searching for unrelated new issues.

Your task is:

ORIGINAL FINDING
+
NEW APPEAL EVIDENCE
=
DOES THE APPEAL ADDRESS THAT ORIGINAL FINDING?

IMPORTANT BOUNDARIES:

- Do NOT determine that fraud occurred.
- Do NOT accuse a provider of fraud.
- Do NOT make a payment decision.
- Do NOT approve or deny a claim.
- Do NOT make a medical diagnosis.
- Do NOT determine medical necessity.
- Do NOT invent facts.
- Do NOT assume evidence exists when it was not supplied.
- Do NOT use outside information.
- Use ONLY the supplied original synthetic claim, original findings, and appeal information.
- Do NOT create unrelated findings that were not part of the original review.

You MUST review every supplied original finding.

For each original finding, return exactly one outcome:

resolved
partially_resolved
not_resolved

OUTCOME DEFINITIONS:

RESOLVED:

Use resolved only when the appeal clearly addresses the original concern.

Examples include:
- corrected billing removes an originally duplicated service,
- corrected units address the original quantity concern,
- corrected billing information addresses the original amount concern,
- previously missing context is now supplied,
- or new documentation directly addresses the original evidence concern.

Do not call something resolved merely because the provider disagrees with the original finding.

PARTIALLY_RESOLVED:

Use partially_resolved when the appeal makes meaningful progress toward addressing the original finding, but the concern is not fully cleared.

Examples include:
- some but not all relevant billing lines were corrected,
- some supporting context was supplied but an important gap remains,
- documentation addresses part of the concern but does not fully explain it,
- or the appeal contains corrective evidence but does not completely resolve the original issue.

NOT_RESOLVED:

Use not_resolved when the appeal does not meaningfully address the original finding.

Examples include:
- the original condition is still visibly present,
- the appeal only repeats a disagreement without supplying corrective evidence,
- relevant support remains absent,
- the appeal evidence does not speak to the original concern,
- or the supplied information is too vague or ambiguous to demonstrate correction.

IMPORTANT CONSERVATIVE RULE:

Ambiguity by itself is NOT resolution.

If the appeal does not provide enough evidence to show that the original concern was addressed, return not_resolved unless the appeal clearly contains meaningful partial corrective evidence.

EVALUATION METHOD:

For each original finding:

1. Identify the exact original concern.
2. Identify the new appeal evidence relevant to that concern.
3. Compare the new evidence against the original concern.
4. Decide whether that concern is:
   - resolved,
   - partially_resolved,
   - or not_resolved.
5. Briefly explain why.
6. Cite the specific appeal information used.

Do not make the explanation about unrelated issues.

If an original finding references a procedure code, preserve that code in lineCode.

If an original finding applies to the whole claim, lineCode may be an empty string.

The findingIndex MUST correspond to the findingIndex supplied in ORIGINAL FINDINGS.

The originalFindingType should preserve the supplied original finding type.

The originalFinding field should briefly restate the supplied original finding.

appealEvidence should identify the specific NEW information in the appeal that supports your outcome.

If no relevant new appeal evidence exists, state that clearly.

OVERALL OUTCOME:

- If every original finding is resolved, overall outcome is resolved.
- If no original finding is resolved or partially resolved, overall outcome is not_resolved.
- If some meaningful issues are addressed but one or more findings remain unresolved, overall outcome is partially_resolved.

Return only the structured JSON required by the schema.
`.trim();


  // =============================================
  // User content
  // =============================================

  const input =
    `
Review this synthetic claim appeal.

ORIGINAL CLAIM:

${JSON.stringify(
  originalClaimPayload,
  null,
  2
)}

ORIGINAL FINDINGS:

${JSON.stringify(
  originalFindingsPayload,
  null,
  2
)}

NEW APPEAL:

${JSON.stringify(
  appealPayload,
  null,
  2
)}

Evaluate only whether the NEW APPEAL addresses each ORIGINAL FINDING.

Do not identify unrelated new claim issues.

Return the structured appeal evidence review.
`.trim();


  try {

    // =============================================
    // OpenAI Responses API
    // =============================================

    const response =
      await client.responses.create({

        model,

        store:
          false,

        instructions,

        input: [
          {

            role:
              "user",

            content: [
              {

                type:
                  "input_text",

                text:
                  input

              }
            ]

          }
        ],


        // =========================================
        // Structured Outputs
        // =========================================

        text: {

          format: {

            type:
              "json_schema",

            name:
              "appeal_evidence_review",

            strict:
              true,

            schema:
              APPEAL_REVIEW_SCHEMA

          }

        }

      });


    // =============================================
    // Responses API convenience output
    // =============================================

    const outputText =
      response.output_text;


    if (
      !outputText
    ) {

      throw new Error(
        "OpenAI returned no structured appeal review text."
      );

    }


    // =============================================
    // Parse structured response
    // =============================================

    const parsed =
      JSON.parse(
        outputText
      );


    // =============================================
    // Normalize results
    // =============================================

    const results =
      Array.isArray(
        parsed.results
      )

        ? parsed.results
            .map(
              normalizeResult
            )
            .filter(Boolean)

        : [];


    // =============================================
    // Make sure the model returned one result for
    // each original finding.
    //
    // If one is missing, create a conservative
    // not_resolved result instead of silently
    // dropping the original finding.
    // =============================================

    const resultsByIndex =
      new Map();


    for (
      const result
      of results
    ) {

      if (
        !resultsByIndex.has(
          result.findingIndex
        )
      ) {

        resultsByIndex.set(
          result.findingIndex,
          result
        );

      }

    }


    const completeResults =
      originalFindingsPayload.map(
        (finding) => {

          const existing =
            resultsByIndex.get(
              finding.findingIndex
            );


          if (
            existing
          ) {

            return {

              ...existing,

              lineCode:
                finding.lineCode ||
                existing.lineCode ||
                "",

              originalFindingType:
                finding.type ||
                existing.originalFindingType ||
                "unknown",

              originalFinding:
                finding.message ||
                existing.originalFinding ||
                ""

            };

          }


          return {

            findingIndex:
              finding.findingIndex,

            lineCode:
              finding.lineCode ||
              "",

            originalFindingType:
              finding.type ||
              "unknown",

            originalFinding:
              finding.message ||
              "",

            outcome:
              "not_resolved",

            explanation:
              "The AI review did not return a determination for this original finding, so it remains unresolved.",

            appealEvidence:
              "No AI appeal determination was returned for this original finding.",

            detectedBy:
              ["ai"]

          };

        }
      );


    // =============================================
    // Derive overall result in code
    // =============================================

    const outcome =
      deriveOverallOutcome(
        completeResults
      );


    // =============================================
    // Return independent AI appeal result
    // =============================================

    return {

      available:
        true,

      outcome,

      summary:
        String(
          parsed.summary ||
          ""
        ).trim(),

      results:
        completeResults

    };


  } catch (
    error
  ) {

    // =============================================
    // AI failure must NEVER stop deterministic
    // appeal review.
    // =============================================

    console.error(
      "AI appeal evidence review error:",
      error?.message ||
      error
    );


    return {

      available:
        false,

      outcome:
        "unavailable",

      summary:
        "AI appeal evidence review unavailable.",

      results:
        []

    };

  }

}