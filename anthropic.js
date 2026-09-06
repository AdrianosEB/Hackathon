// ==================================================
// Anthropic structured-review client
//
// The review stages need a JSON object, not an open-ended
// chat response. A forced tool call gives the Messages API a
// schema for that object while keeping the result local to this
// process: no tool is executed outside the model response.
// ==================================================

const apiKey =
  process.env.ANTHROPIC_API_KEY;


export const anthropicModel =
  process.env.ANTHROPIC_MODEL ||
  "claude-sonnet-4-6";


export function isAnthropicConfigured() {

  return Boolean(
    apiKey
  );

}


export async function createStructuredAnthropicReview(
  {
    system,
    input,
    schema,
    toolName,
    maxTokens = 1600,
    signal
  }
) {

  if (
    !apiKey
  ) {

    throw new Error(
      "ANTHROPIC_API_KEY is not configured."
    );

  }


  const response =
    await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method:
          "POST",

        signal,

        headers: {
          "content-type":
            "application/json",

          "x-api-key":
            apiKey,

          "anthropic-version":
            "2023-06-01"
        },

        body:
          JSON.stringify({
            model:
              anthropicModel,

            max_tokens:
              maxTokens,

            system,

            messages: [
              {
                role:
                  "user",

                content:
                  input
              }
            ],

            tools: [
              {
                name:
                  toolName,

                description:
                  "Return the evidence-review result that matches this schema.",

                input_schema:
                  schema
              }
            ],

            tool_choice: {
              type:
                "tool",

              name:
                toolName
            }
          })
      }
    );


  let payload;


  try {

    payload =
      await response.json();

  } catch {

    throw new Error(
      `Anthropic API returned a non-JSON response (${response.status}).`
    );

  }


  if (
    !response.ok
  ) {

    throw new Error(
      `Anthropic API ${response.status}: ${
        payload?.error?.message ||
        "request failed"
      }`
    );

  }


  const toolUse =
    payload?.content?.find(
      (block) =>
        block?.type ===
          "tool_use" &&
        block?.name ===
          toolName
    );


  if (
    !toolUse ||
    !toolUse.input ||
    typeof toolUse.input !==
      "object"
  ) {

    throw new Error(
      "Anthropic returned no structured review tool result."
    );

  }


  return toolUse.input;

}
