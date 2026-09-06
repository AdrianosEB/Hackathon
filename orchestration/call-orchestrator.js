// ==================================================
// PROVIDER CALL ORCHESTRATOR
//
// Stage three of the workflow.
//
//   claim  -> orchestrateClaim        risk + routing
//   call   -> orchestrateProviderCall clarification
//   appeal -> orchestrateAppeal       outcome
//
// When the claim stage routes a claim to a human, the
// voice agent calls the provider's billing contact
// first and asks about the findings, so the human
// picks the claim up with the provider's answer
// already attached.
//
// This module owns:
//
//   - whether a call happens at all
//   - the brief the agent reads out, and its order
//   - persisting the call, its status, and the
//     transcript
//
// It does NOT own the phone call itself. vapi.js
// still owns the outbound request, the one-at-a-time
// queue, and the polling.
//
// BOUNDARY:
//
// The call gathers clarification. It does not
// negotiate, accept an explanation, close a finding,
// or make any payment decision. Everything it learns
// is attached to the claim for a human to read.
// ==================================================

import {
  queueVapiCall
} from "../vapi.js";


// --------------------------------------------------
// Brief ordering
//
// The agent reads the findings in the order it is
// given them, and a phone call is linear, so the
// worst finding goes first.
//
// Nothing is dropped. A human still sees every
// finding on the claim either way, and a finding left
// out of the call is a finding the provider never got
// asked about.
// --------------------------------------------------

const SEVERITY_ORDER = {

  high:
    0,

  medium:
    1,

  low:
    2

};


function bySeverity(
  first,
  second
) {

  const firstRank =
    SEVERITY_ORDER[
      first.severity
    ] ??
    3;


  const secondRank =
    SEVERITY_ORDER[
      second.severity
    ] ??
    3;


  return firstRank -
    secondRank;

}


// ==================================================
// BUILD THE CALL BRIEF
//
// Returned separately from the queue result so it can
// be inspected and tested without placing a call.
// ==================================================

export function buildCallBrief(
  claim,
  flags = []
) {

  const findings =
    [...flags].sort(
      bySeverity
    );


  return {

    claimNumber:
      claim?.claimNumber ||
      "",

    providerName:
      claim?.providerName ||
      "",

    findings,

    highCount:
      findings.filter(
        (finding) =>
          finding.severity ===
          "high"
      ).length,

    mediumCount:
      findings.filter(
        (finding) =>
          finding.severity ===
          "medium"
      ).length,


    // ----------------------------------------------
    // What the agent will say, one line per finding.
    // vapi.js does the actual formatting; this is the
    // readable preview of it.
    // ----------------------------------------------

    lines:
      findings.map(
        (finding) =>
          `${
            finding.lineCode ||
            "claim-level"
          }: ${
            finding.message ||
            finding.type
          }`
      )

  };

}


// ==================================================
// NORMALIZE A VAPI TRANSCRIPT
//
// Vapi returns a transcript as a string, as an array
// of turns, or as an object, depending on the call.
// Everything downstream wants one string.
// ==================================================

export function normalizeTranscript(
  rawTranscript
) {

  if (
    !rawTranscript
  ) {

    return "";

  }


  if (
    typeof rawTranscript ===
    "string"
  ) {

    return rawTranscript;

  }


  if (
    Array.isArray(
      rawTranscript
    )
  ) {

    return rawTranscript
      .map(
        (entry) => {

          const speaker =

            entry.role ===
              "assistant"

              ? "Assistant"

              : entry.role ===
                  "user"

                ? "Customer"

                : entry.role ||
                  "Speaker";


          const content =

            entry.message ||

            entry.content ||

            entry.text ||

            "";


          return `${speaker}: ${content}`;

        }
      )
      .join("\n");

  }


  try {

    return JSON.stringify(
      rawTranscript,
      null,
      2
    );

  } catch {

    return String(
      rawTranscript
    );

  }

}


// ==================================================
// PERSISTENCE HANDLERS
//
// vapi.js drives the call and hands back lifecycle
// events. The store is injected so this module has no
// database import of its own, which is what lets the
// examples run the whole lifecycle against a fake.
//
// A store failure is logged and swallowed. Losing a
// call record must never take down a call that is
// already in progress.
// ==================================================

function buildHandlers(
  claim,
  store,
  logger
) {

  const claimNumber =
    claim.claimNumber;


  function safely(
    label,
    action
  ) {

    try {

      action();

    } catch (
      error
    ) {

      logger.error(
        `${label}:`,
        error?.message ||
        error
      );

    }

  }


  return {

    // ----------------------------------------------
    // CALL STARTED
    // ----------------------------------------------

    onStarted:
      async (
        result
      ) => {

        logger.log(
          `Clarification call started for ${claimNumber}`
        );


        if (
          typeof store?.createVapiCall !==
          "function"
        ) {

          return;

        }


        safely(
          "Could not save Vapi call",
          () =>
            store.createVapiCall(
              claimNumber,
              result.callId,
              result.status ||
                "created"
            )
        );

      },


    // ----------------------------------------------
    // POLLING UPDATE
    // ----------------------------------------------

    onUpdate:
      async (
        call
      ) => {

        if (
          typeof store?.updateVapiCallStatus !==
          "function"
        ) {

          return;

        }


        safely(
          "Could not update Vapi call",
          () =>
            store.updateVapiCallStatus(
              call.id,
              call.status ||
                "in-progress"
            )
        );

      },


    // ----------------------------------------------
    // CALL COMPLETED
    // ----------------------------------------------

    onCompleted:
      async (
        call
      ) => {

        const transcript =
          normalizeTranscript(
            call.artifact
              ?.transcript ||

            call.transcript ||

            ""
          );


        const messages =

          call.artifact
            ?.messages ||

          call.messages ||

          [];


        if (
          typeof store?.completeVapiCall ===
          "function"
        ) {

          safely(
            "Could not complete Vapi call",
            () =>
              store.completeVapiCall(
                call.id,
                {

                  status:
                    call.status ||
                    "ended",

                  endedReason:
                    call.endedReason ||
                    null,

                  transcript,

                  messages,

                  startedAt:
                    call.startedAt ||
                    null,

                  endedAt:
                    call.endedAt ||
                    null

                }
              )
          );

        }


        logger.log(
          `Clarification call completed for ${claimNumber}`
        );

      },


    // ----------------------------------------------
    // CALL FAILED
    // ----------------------------------------------

    onFailed:
      async (
        error,
        callId
      ) => {

        logger.error(
          `Clarification call failed for ${claimNumber}:`,
          error?.message ||
          error
        );


        if (
          !callId ||
          typeof store?.updateVapiCallStatus !==
            "function"
        ) {

          return;

        }


        safely(
          "Could not save failed Vapi call",
          () =>
            store.updateVapiCallStatus(
              callId,
              "failed"
            )
        );

      },


    // ----------------------------------------------
    // CALL SKIPPED
    //
    // Vapi is disabled or not fully configured. The
    // claim is already saved and already routed to a
    // human, so there is nothing to repair.
    // ----------------------------------------------

    onSkipped:
      async (
        result
      ) => {

        logger.log(
          `Clarification call skipped for ${claimNumber}: ${
            result.reason ||
            "no reason given"
          }`
        );

      }

  };

}


// ==================================================
// ORCHESTRATE THE PROVIDER CALL
//
//   claim     the normalized incoming claim
//   decision  the record from orchestrateClaim
//
// Options:
//
//   store   { createVapiCall,
//             updateVapiCallStatus,
//             completeVapiCall }
//
//   queue   defaults to vapi.js queueVapiCall,
//           replaced by the examples with a fake
//
// Returns immediately. The call itself runs in the
// background so claim analysis never waits on a phone
// call.
// ==================================================

export function orchestrateProviderCall(
  claim,
  decision,
  {

    store =
      null,

    queue =
      queueVapiCall,

    logger =
      console

  } = {}
) {

  // ------------------------------------------------
  // The claim stage already decided this.
  // ------------------------------------------------

  if (
    !decision?.routing?.shouldCallProvider
  ) {

    return {

      queued:
        false,

      reason:
        `Routing decided ${
          decision?.routing?.nextStep ||
          "no call"
        }.`,

      brief:
        null

    };

  }


  const brief =
    buildCallBrief(
      claim,
      decision.analysis?.flags ||
      []
    );


  const result =
    queue(
      claim,
      brief.findings,
      buildHandlers(
        claim,
        store,
        logger
      )
    );


  logger.log(
    `[call] ${brief.claimNumber}: ${
      result.queued
        ? `queued at position ${result.position}`
        : `not queued (${result.reason})`
    }, ${brief.findings.length} finding(s) in the brief`
  );


  return {

    ...result,

    brief

  };

}
