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
// This allows deterministic rules to continue
// working even if OpenAI is unavailable.
// =============================================

const client =
  apiKey
    ? new OpenAI({
        apiKey
      })
    : null;


// =============================================
// Valid AI finding reasons
// =============================================

const VALID_REASONS =
  new Set([
    "explicit_contradiction",
    "missing_support",
    "unusual_billing",
    "documentation_mismatch",
    "duplicate_service",
    "needs_review"
  ]);


// =============================================
// Normalize risk level
// =============================================

function normalizeRiskLevel(
  value
) {

  const level =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();


  if (
    level === "high"
  ) {

    return "high";
  }


  if (
    level === "review" ||
    level === "medium"
  ) {

    return "review";
  }


  return "low";
}


// =============================================
// Convert numeric score to rating
//
// We enforce this in code even though the model
// also returns a rating.
//
// This prevents a model response such as:
//
// score: 75
// riskLevel: "low"
//
// from creating an inconsistent result.
// =============================================

function riskLevelFromScore(
  score
) {

  if (
    score >= 60
  ) {

    return "high";
  }


  if (
    score >= 25
  ) {

    return "review";
  }


  return "low";
}


// =============================================
// Clamp score to 0–100
// =============================================

function normalizeScore(
  value
) {

  const number =
    Number(value);


  if (
    !Number.isFinite(number)
  ) {

    return 0;
  }


  return Math.max(
    0,
    Math.min(
      100,
      Math.round(number)
    )
  );
}


// =============================================
// Normalize one AI finding
// =============================================

function normalizeFinding(
  finding
) {

  if (
    !finding ||
    typeof finding !== "object"
  ) {

    return null;
  }


  const reason =
    String(
      finding.reason ||
      "needs_review"
    )
      .trim()
      .toLowerCase();


  return {

    lineCode:
      finding.lineCode
        ? String(
            finding.lineCode
          ).trim()
        : "",


    severity:
      normalizeRiskLevel(
        finding.severity
      ) === "high"

        ? "high"

        : normalizeRiskLevel(
            finding.severity
          ) === "review"

          ? "medium"

          : "low",


    reason:
      VALID_REASONS.has(
        reason
      )
        ? reason
        : "needs_review",


    message:
      String(
        finding.message ||
        ""
      ).trim(),


    evidence:
      String(
        finding.evidence ||
        ""
      ).trim()

  };
}


// =============================================
// Build compact claim payload for AI
//
// We give the model only information from the
// submitted synthetic claim.
//
// No outside medical assumptions should be made.
// =============================================

function buildClaimForAI(
  claim
) {

  return {

    claimNumber:
      claim.claimNumber ||
      "",

    providerName:
      claim.providerName ||
      "",

    patientLabel:
      claim.patientLabel ||
      "",

    diagnosisCodes:
      Array.isArray(
        claim.diagnosisCodes
      )
        ? claim.diagnosisCodes
        : [],

    clinicalNote:
      claim.clinicalNote ||
      "",

    lineItems:
      Array.isArray(
        claim.lineItems
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
// Structured output schema
// =============================================

const AI_REVIEW_SCHEMA = {

  type:
    "object",

  additionalProperties:
    false,

  properties: {

    riskScore: {

      type:
        "integer",

      minimum:
        0,

      maximum:
        100

    },


    riskLevel: {

      type:
        "string",

      enum: [
        "low",
        "review",
        "high"
      ]

    },


    summary: {

      type:
        "string"

    },


    findings: {

      type:
        "array",

      items: {

        type:
          "object",

        additionalProperties:
          false,

        properties: {

          lineCode: {

            type:
              "string"

          },


          severity: {

            type:
              "string",

            enum: [
              "low",
              "medium",
              "high"
            ]

          },


          reason: {

            type:
              "string",

            enum: [
              "explicit_contradiction",
              "missing_support",
              "unusual_billing",
              "documentation_mismatch",
              "duplicate_service",
              "needs_review"
            ]

          },


          message: {

            type:
              "string"

          },


          evidence: {

            type:
              "string"

          }

        },

        required: [
          "lineCode",
          "severity",
          "reason",
          "message",
          "evidence"
        ]

      }

    }

  },

  required: [
    "riskScore",
    "riskLevel",
    "summary",
    "findings"
  ]

};


// =============================================
// AI evidence reviewer
// =============================================

export async function reviewClaimWithAI(
  claim
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

      riskScore:
        0,

      riskLevel:
        "unavailable",

      summary:
        "AI evidence review unavailable.",

      findings:
        []

    };

  }


  const claimPayload =
    buildClaimForAI(
      claim
    );


  // =============================================
  // Instructions
  //
  // Important product boundary:
  //
  // AI reviews evidence/documentation.
  //
  // It does NOT determine fraud.
  // It does NOT make payment decisions.
  // It does NOT make medical decisions.
  // =============================================

  const instructions = `
You are an evidence-review assistant for a synthetic medical billing hackathon demo.

Your job is to help a HUMAN CLAIM REVIEWER identify documentation or billing evidence that may deserve manual review.

IMPORTANT BOUNDARIES:

- Do NOT determine that fraud occurred.
- Do NOT accuse a provider of fraud.
- Do NOT make a payment decision.
- Do NOT approve or deny a claim.
- Do NOT make a medical diagnosis.
- Do NOT determine medical necessity.
- Do NOT invent facts that are not present in the submitted claim.
- Do NOT assume missing information exists.
- Use ONLY the information contained in the supplied synthetic claim.

Your role is EVIDENCE REVIEW.

Look for things such as:

1. Explicit contradictions between the billed service and supplied documentation.
2. Billed services for which the supplied documentation does not clearly provide support.
3. Unusual billing patterns visible directly in the supplied claim.
4. Documentation that appears inconsistent with a billed procedure.
5. Potential duplicate or reused service support.
6. Situations where the available evidence is insufficient and a human reviewer should request clarification.

For each meaningful concern, create a finding.

Allowed finding reasons:

- explicit_contradiction
- missing_support
- unusual_billing
- documentation_mismatch
- duplicate_service
- needs_review

SEVERITY GUIDANCE:

LOW:
The evidence is generally consistent or the concern is weak.
This does not by itself require significant escalation.

MEDIUM:
There is a meaningful documentation or billing concern that deserves human review or clarification.

HIGH:
There is a strong explicit contradiction, major unsupported billed service, or other clear evidence conflict that deserves priority human review.

AI SCORE:

Return an independent AI evidence-risk score from 0 to 100.

Use these score bands:

0-24 = low
25-59 = review
60-100 = high

The score should reflect ONLY your AI evidence review.

Do not incorporate any deterministic rule score because the deterministic system is evaluated separately.

The AI score should increase when:
- evidence directly contradicts a billed service,
- important support appears absent,
- several significant documentation issues are present,
- or a major mismatch exists between the supplied claim and documentation.

Do not raise the score merely because information is unfamiliar or uncertain.

If the claim contains no meaningful evidence issue, return a low score and an empty findings array.

For every finding:
- lineCode should contain the relevant procedure code when one exists.
- If the issue applies to the entire claim rather than one procedure, use an empty string.
- message should briefly explain what needs review.
- evidence should cite the specific information from the supplied claim that led to the finding.

Return only the structured JSON response required by the schema.
`.trim();


  // =============================================
  // User content
  // =============================================

  const input =
    `
Review this synthetic claim.

CLAIM DATA:

${JSON.stringify(
  claimPayload,
  null,
  2
)}

Return a JSON evidence review using only the supplied claim information.
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
              "claim_evidence_review",

            strict:
              true,

            schema:
              AI_REVIEW_SCHEMA

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
        "OpenAI returned no structured review text."
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
    // Normalize AI score
    // =============================================

    const riskScore =
      normalizeScore(
        parsed.riskScore
      );


    // =============================================
    // IMPORTANT:
    //
    // Score is authoritative for AI rating.
    //
    // This keeps score/rating internally consistent.
    // =============================================

    const riskLevel =
      riskLevelFromScore(
        riskScore
      );


    // =============================================
    // Normalize findings
    // =============================================

    const findings =
      Array.isArray(
        parsed.findings
      )

        ? parsed.findings
            .map(
              normalizeFinding
            )
            .filter(Boolean)

        : [];


    // =============================================
    // Return independent AI result
    // =============================================

    return {

      available:
        true,

      riskScore,

      riskLevel,

      summary:
        String(
          parsed.summary ||
          ""
        ).trim(),

      findings

    };


  } catch (error) {

    // =============================================
    // AI failure must NEVER stop deterministic rules
    // =============================================

    console.error(
      "AI evidence review error:",
      error?.message ||
      error
    );


    return {

      available:
        false,

      riskScore:
        0,

      riskLevel:
        "unavailable",

      summary:
        "AI evidence review unavailable.",

      findings:
        []

    };

  }

}