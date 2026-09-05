import "dotenv/config";
import OpenAI from "openai";

const MODEL =
  process.env.OPENAI_MODEL || "gpt-5.6-luna";

export async function reviewClaimWithAI(claim) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      available: false,
      findings: [],
      error: "OPENAI_API_KEY is missing"
    };
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const response = await client.responses.create({
    model: MODEL,

    instructions: `
You are an AI evidence reviewer for a SYNTHETIC medical
billing hackathon demonstration.

You are reviewing billing anomalies for a human analyst.

IMPORTANT RULES:

- Use ONLY information supplied in the claim.
- Do NOT determine fraud.
- Do NOT make payment or medical decisions.
- Do NOT invent facts.
- Do NOT assume missing information.
- Only flag something when the supplied information
  provides a reasonable basis for human review.

Possible reasons:

- explicit_contradiction
- missing_support
- unusual_billing
- documentation_mismatch
- duplicate_service
- needs_review

For each finding:

1. Identify the procedure code.
2. Give a severity of low, medium, or high.
3. Explain the issue clearly.
4. Quote or describe the evidence from the supplied claim.
5. Remember that the human analyst makes the final decision.

Return structured JSON matching the provided schema.
`,

    input: JSON.stringify(claim),

    text: {
      format: {
        type: "json_schema",
        name: "claim_review",
        strict: true,

        schema: {
          type: "object",

          properties: {
            findings: {
              type: "array",

              items: {
                type: "object",

                properties: {
                  lineCode: {
                    type: "string"
                  },

                  severity: {
                    type: "string",
                    enum: [
                      "low",
                      "medium",
                      "high"
                    ]
                  },

                  reason: {
                    type: "string",
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
                    type: "string"
                  },

                  evidence: {
                    type: "string"
                  }
                },

                required: [
                  "lineCode",
                  "severity",
                  "reason",
                  "message",
                  "evidence"
                ],

                additionalProperties: false
              }
            }
          },

          required: [
            "findings"
          ],

          additionalProperties: false
        }
      }
    }
  });

  const parsed =
    JSON.parse(response.output_text);

  return {
    available: true,
    findings: parsed.findings
  };
}