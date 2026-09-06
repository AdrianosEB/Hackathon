import "dotenv/config";


const VAPI_BASE_URL =
  "https://api.vapi.ai";


const POLL_INTERVAL_MS =
  1000;


// 300 attempts x 3 seconds = 15 minutes maximum
const MAX_POLL_ATTEMPTS =
  300;


// =============================================
// Queue state
// =============================================

const callQueue =
  [];


let activeQueueItem =
  null;


// Prevent duplicate queue entries during
// the same Node server session.
const queuedClaimNumbers =
  new Set();


// =============================================
// Sleep helper
// =============================================

function sleep(
  milliseconds
) {

  return new Promise(
    (resolve) => {

      setTimeout(
        resolve,
        milliseconds
      );

    }
  );

}


// =============================================
// Check Vapi configuration
// =============================================

function vapiConfigured() {

  return Boolean(
    process.env.VAPI_API_KEY &&
    process.env.VAPI_ASSISTANT_ID &&
    process.env.VAPI_PHONE_NUMBER_ID &&
    process.env.DEMO_BILLING_CONTACT
  );

}


// =============================================
// Start one outbound Vapi call
// =============================================

export async function startVapiCall(
  claim,
  findings = []
) {

  if (
    process.env.DEMO_AUTO_CALL !==
    "true"
  ) {

    return {

      triggered:
        false,

      reason:
        "DEMO_AUTO_CALL is disabled"

    };

  }


  if (
    !vapiConfigured()
  ) {

    return {

      triggered:
        false,

      reason:
        "Vapi configuration is incomplete"

    };

  }


  const findingsText =

    findings.length > 0

      ? findings
          .map(
            (
              finding,
              index
            ) => {

              const code =
                finding.lineCode ||
                "claim-level";


              const message =
                finding.message ||
                finding.reason ||
                "Needs review";


              const evidence =
                finding.evidence
                  ? ` Evidence: ${finding.evidence}`
                  : "";


              return (
                `${index + 1}. ` +
                `${code}: ` +
                `${message}.` +
                `${evidence}`
              );

            }
          )
          .join("\n")

      : "No detailed findings were supplied.";


  const response =
    await fetch(
      `${VAPI_BASE_URL}/call`,
      {

        method:
          "POST",

        headers: {

          Authorization:
            `Bearer ${process.env.VAPI_API_KEY}`,

          "Content-Type":
            "application/json"

        },

        body:
          JSON.stringify(
            {

              assistantId:
                process.env.VAPI_ASSISTANT_ID,

              phoneNumberId:
                process.env.VAPI_PHONE_NUMBER_ID,

              customer: {

                number:
                  process.env.DEMO_BILLING_CONTACT

              },

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

            }
          )

      }
    );


  const text =
    await response.text();


  let data =
    {};


  try {

    data =
      text
        ? JSON.parse(
            text
          )
        : {};

  } catch {

    data = {

      raw:
        text

    };

  }


  if (
    !response.ok
  ) {

    throw new Error(
      data.message ||
      data.error ||
      `Vapi call failed with status ${response.status}`
    );

  }


  console.log(
    `Vapi call started for ${claim.claimNumber}: ${data.id}`
  );


  return {

    triggered:
      true,

    callId:
      data.id,

    status:
      data.status ||
      "created",

    raw:
      data

  };

}


// =============================================
// Get Vapi call
// =============================================

export async function getVapiCall(
  callId
) {

  if (
    !process.env.VAPI_API_KEY
  ) {

    throw new Error(
      "VAPI_API_KEY is missing."
    );

  }


  const response =
    await fetch(
      `${VAPI_BASE_URL}/call/${callId}`,
      {

        headers: {

          Authorization:
            `Bearer ${process.env.VAPI_API_KEY}`

        }

      }
    );


  const text =
    await response.text();


  let data =
    {};


  try {

    data =
      text
        ? JSON.parse(
            text
          )
        : {};

  } catch {

    data = {

      raw:
        text

    };

  }


  if (
    !response.ok
  ) {

    throw new Error(
      data.message ||
      data.error ||
      `Could not retrieve Vapi call ${callId}`
    );

  }


  return data;

}


// =============================================
// Check whether call is finished
// =============================================

function callHasEnded(
  call
) {

  if (
    !call
  ) {

    return false;

  }


  if (
    call.endedAt
  ) {

    return true;

  }


  if (
    call.status === "ended"
  ) {

    return true;

  }


  return false;

}


// =============================================
// Poll current call until it finishes
// =============================================

async function waitForCallToFinish(
  callId,
  onUpdate
) {

  for (
    let attempt = 0;
    attempt < MAX_POLL_ATTEMPTS;
    attempt += 1
  ) {

    const call =
      await getVapiCall(
        callId
      );


    if (
      typeof onUpdate ===
      "function"
    ) {

      await onUpdate(
        call
      );

    }


    if (
      callHasEnded(
        call
      )
    ) {

      return call;

    }


    await sleep(
      POLL_INTERVAL_MS
    );

  }


  throw new Error(
    `Timed out waiting for Vapi call ${callId} to finish.`
  );

}


// =============================================
// Process call queue
// =============================================

async function processCallQueue() {

  // One call is already active.
  if (
    activeQueueItem
  ) {

    return;

  }


  const next =
    callQueue.shift();


  if (
    !next
  ) {

    return;

  }


  activeQueueItem =
    next;


  console.log(
    `Vapi queue: starting ${next.claim.claimNumber}`
  );


  try {

    const result =
      await startVapiCall(
        next.claim,
        next.findings
      );


    if (
      !result.triggered
    ) {

      console.log(
        `Vapi queue skipped ${next.claim.claimNumber}: ${result.reason}`
      );


      if (
        typeof next.onSkipped ===
        "function"
      ) {

        await next.onSkipped(
          result
        );

      }


      return;

    }


    next.callId =
      result.callId;


    if (
      typeof next.onStarted ===
      "function"
    ) {

      await next.onStarted(
        result
      );

    }


    const finishedCall =
      await waitForCallToFinish(
        result.callId,
        next.onUpdate
      );


    console.log(
      `Vapi queue: ${next.claim.claimNumber} finished`
    );


    if (
      typeof next.onCompleted ===
      "function"
    ) {

      await next.onCompleted(
        finishedCall
      );

    }

  } catch (error) {

    console.error(
      `Vapi queue error for ${next.claim.claimNumber}:`,
      error.message
    );


    if (
      typeof next.onFailed ===
      "function"
    ) {

      try {

        await next.onFailed(
          error,
          next.callId
        );

      } catch (
        callbackError
      ) {

        console.error(
          "Vapi failure callback error:",
          callbackError.message
        );

      }

    }

  } finally {

    queuedClaimNumbers.delete(
      next.claim.claimNumber
    );


    activeQueueItem =
      null;


    // Start the next queued call.
    processCallQueue();

  }

}


// =============================================
// Queue a claim
// =============================================

export function queueVapiCall(
  claim,
  findings = [],
  handlers = {}
) {

  if (
    process.env.DEMO_AUTO_CALL !==
    "true"
  ) {

    return {

      queued:
        false,

      reason:
        "DEMO_AUTO_CALL is disabled"

    };

  }


  if (
    !claim?.claimNumber
  ) {

    return {

      queued:
        false,

      reason:
        "Claim number is missing"

    };

  }


  if (
    queuedClaimNumbers.has(
      claim.claimNumber
    )
  ) {

    return {

      queued:
        false,

      duplicate:
        true,

      reason:
        "Claim is already queued or being called"

    };

  }


  queuedClaimNumbers.add(
    claim.claimNumber
  );


  callQueue.push(
    {

      claim,

      findings,

      callId:
        null,

      onStarted:
        handlers.onStarted,

      onUpdate:
        handlers.onUpdate,

      onCompleted:
        handlers.onCompleted,

      onFailed:
        handlers.onFailed,

      onSkipped:
        handlers.onSkipped

    }
  );


  const position =

    activeQueueItem
      ? callQueue.length
      : 1;


  console.log(
    `Vapi queue: ${claim.claimNumber} added at position ${position}`
  );


  // Start worker without blocking claim analysis.
  processCallQueue();


  return {

    queued:
      true,

    position

  };

}


// =============================================
// Return queue status
// =============================================

export function getVapiQueueStatus() {

  return {

    active:

      activeQueueItem

        ? {

            claimNumber:
              activeQueueItem
                .claim
                .claimNumber,

            callId:
              activeQueueItem.callId

          }

        : null,

    queued:

      callQueue.map(
        (
          item,
          index
        ) => ({

          position:
            index + 1,

          claimNumber:
            item.claim.claimNumber

        })
      )

  };

}