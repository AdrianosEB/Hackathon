import "dotenv/config";


// ==================================================
// Automatic Vapi clarification call
// ==================================================

export async function triggerVapiClarification(
  claim,
  analysis
) {

  // ------------------------------------------------
  // Kill switch
  // ------------------------------------------------

  if (
    process.env.DEMO_AUTO_CALL !== "true"
  ) {

    return {
      triggered: false,
      reason: "auto_call_disabled"
    };

  }


  // ------------------------------------------------
  // Make sure required configuration exists
  // ------------------------------------------------

  const requiredVariables = [
    "VAPI_API_KEY",
    "VAPI_ASSISTANT_ID",
    "VAPI_PHONE_NUMBER_ID",
    "DEMO_BILLING_CONTACT"
  ];


  const missing =
    requiredVariables.filter(
      (name) =>
        !process.env[name]
    );


  if (missing.length > 0) {

    console.log(
      "Vapi not configured. Missing:",
      missing.join(", ")
    );


    return {
      triggered: false,
      reason: "missing_configuration"
    };

  }


  // ------------------------------------------------
  // Only automatically call for HIGH severity
  // findings.
  // ------------------------------------------------

  const highSeverityFindings =
    analysis.flags.filter(
      (flag) =>
        flag.severity === "high"
    );


  if (
    highSeverityFindings.length === 0
  ) {

    console.log(
      `No high-severity findings for ${claim.claimNumber}. No call triggered.`
    );


    return {
      triggered: false,
      reason: "no_high_severity_findings"
    };

  }


  // ------------------------------------------------
  // Build a concise finding summary for Vapi
  // ------------------------------------------------

  const findingsText =
    highSeverityFindings
      .map(
        (flag, index) => {

          const code =
            flag.lineCode
              ? `Procedure ${flag.lineCode}`
              : "Claim finding";


          const message =
            flag.aiReview?.message ||
            flag.message ||
            "Needs clarification";


          const evidence =
            flag.aiReview?.evidence ||
            flag.evidence ||
            "No additional evidence supplied";


          return (
            `${index + 1}. ` +
            `${code}: ` +
            `${message}. ` +
            `Evidence: ${evidence}`
          );

        }
      )
      .join("\n");


  // ------------------------------------------------
  // Build Vapi outbound-call request
  // ------------------------------------------------

  const body = {

    assistantId:
      process.env.VAPI_ASSISTANT_ID,

    phoneNumberId:
      process.env.VAPI_PHONE_NUMBER_ID,

    customer: {

      number:
        process.env.DEMO_BILLING_CONTACT

    },


    // These variables can be referenced by the
    // assistant as:
    //
    // {{claimNumber}}
    // {{providerName}}
    // {{findings}}

    assistantOverrides: {

      variableValues: {

        claimNumber:
          claim.claimNumber,

        providerName:
          claim.providerName,

        findings:
          findingsText

      }

    }

  };


  console.log(
    `Triggering Vapi clarification call for ${claim.claimNumber}...`
  );


  // ------------------------------------------------
  // Call Vapi
  // ------------------------------------------------

  const response =
    await fetch(
      "https://api.vapi.ai/call",
      {

        method:
          "POST",

        headers: {

          "Authorization":
            `Bearer ${process.env.VAPI_API_KEY}`,

          "Content-Type":
            "application/json"

        },

        body:
          JSON.stringify(body)

      }
    );


  const data =
    await response.json();


  // ------------------------------------------------
  // Handle errors
  // ------------------------------------------------

  if (!response.ok) {

    const message =
      data?.message ||
      data?.error ||
      JSON.stringify(data);


    throw new Error(
      `Vapi call failed: ${message}`
    );

  }


  console.log(
    `Vapi call created: ${data.id}`
  );


  return {

    triggered: true,

    callId:
      data.id,

    status:
      data.status || "created"

  };

}