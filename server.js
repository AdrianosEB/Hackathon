import "dotenv/config";

import express from "express";

import {
  orchestrateClaim
} from "./orchestration/claim-orchestrator.js";

import {
  orchestrateAppeal
} from "./orchestration/appeal-orchestrator.js";

import {
  getVapiQueueStatus
} from "./vapi.js";

import {
  orchestrateProviderCall,
  normalizeTranscript
} from "./orchestration/call-orchestrator.js";

import {
  createClaim,
  getClaim,
  listClaims,
  getDashboardStats,
  getProviderRiskStats,

  getLatestClaimByClaimNumber,

  createAppeal,
  getAppeal,
  listAppeals,
  getAppealsForClaim,
  getAppealStats,

  createVapiCall,
  updateVapiCallStatus,
  completeVapiCall,
  getVapiCallsForClaim
} from "./db.js";


// =============================================
// Call persistence
//
// Injected into the call orchestrator so the
// orchestration layer stays free of database
// imports and can be exercised against a fake.
// =============================================

const VAPI_CALL_STORE = {

  createVapiCall,

  updateVapiCallStatus,

  completeVapiCall

};


// =============================================
// Express
// =============================================

const app =
  express();


const PORT =
  process.env.PORT ||
  3000;


// =============================================
// Middleware
// =============================================

app.use(
  express.json({
    limit:
      "2mb"
  })
);


app.use(
  express.static(
    "website"
  )
);


// =============================================
// Normalize diagnosis codes
// =============================================

function normalizeDiagnosisCodes(
  value
) {

  if (
    Array.isArray(
      value
    )
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
      .split(
        /[;,|]/
      )
      .map(
        (code) =>
          code.trim()
      )
      .filter(Boolean);

  }


  return [];

}


// =============================================
// Normalize incoming line items
// =============================================

function normalizeLineItems(
  value
) {

  const lineItems =

    Array.isArray(
      value
    )

      ? value

      : [];


  return lineItems.map(
    (item) => ({

      code:
        String(
          item?.code ||
          ""
        ).trim(),

      description:
        String(
          item?.description ||
          ""
        ).trim(),

      serviceDate:
        String(
          item?.serviceDate ||
          ""
        ).trim(),

      units:
        Number(
          item?.units ||
          0
        ),

      amount:
        Number(
          item?.amount ||
          0
        )

    })
  );

}


// =============================================
// Normalize incoming claim
// =============================================

function normalizeIncomingClaim(
  claim = {}
) {

  return {

    claimNumber:
      String(
        claim.claimNumber ||
        ""
      ).trim(),

    providerName:
      String(
        claim.providerName ||
        ""
      ).trim(),

    patientLabel:
      String(
        claim.patientLabel ||
        ""
      ).trim(),

    diagnosisCodes:
      normalizeDiagnosisCodes(
        claim.diagnosisCodes
      ),

    clinicalNote:
      String(
        claim.clinicalNote ||
        ""
      ).trim(),

    lineItems:
      normalizeLineItems(
        claim.lineItems
      )

  };

}


// =============================================
// Validate claim
// =============================================

function validateClaim(
  claim
) {

  if (
    !claim.claimNumber
  ) {

    return "Claim number is required.";

  }


  if (
    !claim.providerName
  ) {

    return "Provider name is required.";

  }


  if (
    !Array.isArray(
      claim.lineItems
    ) ||
    claim.lineItems.length ===
      0
  ) {

    return "At least one procedure is required.";

  }


  for (
    const item
    of claim.lineItems
  ) {

    if (
      !item.code
    ) {

      return "Every procedure needs a code.";

    }


    if (
      !item.serviceDate
    ) {

      return (
        `Procedure ${item.code} ` +
        "needs a service date."
      );

    }


    if (
      !Number.isFinite(
        item.units
      ) ||
      item.units <=
      0
    ) {

      return (
        `Procedure ${item.code} ` +
        "has invalid units."
      );

    }


    if (
      !Number.isFinite(
        item.amount
      ) ||
      item.amount <
      0
    ) {

      return (
        `Procedure ${item.code} ` +
        "has an invalid amount."
      );

    }

  }


  return null;

}


// =============================================
// Normalize incoming appeal
//
// Appeal CSVs will eventually be converted by the
// browser into this same object shape.
// =============================================

function normalizeIncomingAppeal(
  appeal = {}
) {

  return {

    claimNumber:
      String(
        appeal.claimNumber ||
        ""
      ).trim(),

    providerName:
      String(
        appeal.providerName ||
        ""
      ).trim(),

    appealReason:
      String(
        appeal.appealReason ||
        ""
      ).trim(),

    appealNote:
      String(
        appeal.appealNote ||
        ""
      ).trim(),

    supportingEvidence:
      String(
        appeal.supportingEvidence ||
        ""
      ).trim(),

    diagnosisCodes:
      normalizeDiagnosisCodes(
        appeal.diagnosisCodes
      ),

    clinicalNote:
      String(
        appeal.clinicalNote ||
        ""
      ).trim(),

    lineItems:
      normalizeLineItems(
        appeal.lineItems
      )

  };

}


// =============================================
// Validate appeal
// =============================================

function validateAppeal(
  appeal
) {

  // ===========================================
  // claimNumber is the link to the original
  // analyzed claim.
  // ===========================================

  if (
    !appeal.claimNumber
  ) {

    return "Claim number is required for an appeal.";

  }


  // ===========================================
  // Our agreed appeal CSV represents corrected
  // billing data, so require at least one line.
  //
  // This also prevents an empty CSV from making
  // a duplicate/quantity/price problem appear
  // falsely corrected simply because no lines
  // were submitted.
  // ===========================================

  if (
    !Array.isArray(
      appeal.lineItems
    ) ||
    appeal.lineItems.length ===
      0
  ) {

    return (
      "The appeal must contain at least one " +
      "corrected billing line."
    );

  }


  for (
    const item
    of appeal.lineItems
  ) {

    if (
      !item.code
    ) {

      return (
        "Every appeal billing line needs " +
        "a procedure code."
      );

    }


    if (
      !item.serviceDate
    ) {

      return (
        `Appeal procedure ${item.code} ` +
        "needs a service date."
      );

    }


    if (
      !Number.isFinite(
        item.units
      ) ||
      item.units <=
        0
    ) {

      return (
        `Appeal procedure ${item.code} ` +
        "has invalid units."
      );

    }


    if (
      !Number.isFinite(
        item.amount
      ) ||
      item.amount <
        0
    ) {

      return (
        `Appeal procedure ${item.code} ` +
        "has an invalid amount."
      );

    }

  }


  return null;

}


// =============================================
// Dashboard
// =============================================

app.get(
  "/api/dashboard",
  (
    req,
    res
  ) => {

    try {

      res.json({

        claims:
          listClaims(),

        stats:
          getDashboardStats()

      });

    } catch (
      error
    ) {

      console.error(
        "Dashboard error:",
        error
      );


      res
        .status(
          500
        )
        .json({

          error:
            "Could not load dashboard."

        });

    }

  }
);


// =============================================
// Provider analytics
// =============================================

app.get(
  "/api/providers/stats",
  (
    req,
    res
  ) => {

    try {

      const providers =
        getProviderRiskStats();


      res.json({

        providers

      });

    } catch (
      error
    ) {

      console.error(
        "Provider analytics error:",
        error
      );


      res
        .status(
          500
        )
        .json({

          error:
            "Could not load provider analytics."

        });

    }

  }
);


// =============================================
// Get one claim
// =============================================

app.get(
  "/api/claims/:id",
  (
    req,
    res
  ) => {

    try {

      const claim =
        getClaim(
          req.params.id
        );


      if (
        !claim
      ) {

        return res
          .status(
            404
          )
          .json({

            error:
              "Claim not found."

          });

      }


      res.json(
        claim
      );

    } catch (
      error
    ) {

      console.error(
        "Get claim error:",
        error
      );


      res
        .status(
          500
        )
        .json({

          error:
            "Could not load claim."

        });

    }

  }
);


// =============================================
// Analyze claim
// =============================================

app.post(
  "/api/claims/analyze",
  async (
    req,
    res
  ) => {

    try {

      const cleanClaim =
        normalizeIncomingClaim(
          req.body
        );


      const validationError =
        validateClaim(
          cleanClaim
        );


      if (
        validationError
      ) {

        return res
          .status(
            400
          )
          .json({

            error:
              validationError

          });

      }


      // =======================================
      // ORCHESTRATION
      //
      // Deterministic rules, AI evidence review,
      // the merge, and the routing decision all
      // live in the claim orchestrator.
      // =======================================

      const decision =
        await orchestrateClaim(
          cleanClaim
        );


      const analysis =
        decision.analysis;


      const finalRiskLevel =
        decision.verdict.riskLevel;


      // =======================================
      // SAVE CLAIM
      // =======================================

      const savedClaim =
        createClaim(
          cleanClaim,
          analysis
        );


      console.log(
        `Claim ${cleanClaim.claimNumber} saved with final risk: ${finalRiskLevel}`
      );


      // =======================================
      // PROVIDER CLARIFICATION CALL
      //
      // Runs in the background. Whether it happens
      // at all was already decided by the claim
      // stage routing.
      // =======================================

      orchestrateProviderCall(
        cleanClaim,
        decision,
        {
          store:
            VAPI_CALL_STORE
        }
      );


      res.json(
        savedClaim
      );

    } catch (
      error
    ) {

      console.error(
        "Analyze claim error:",
        error
      );


      res
        .status(
          500
        )
        .json({

          error:
            error.message ||
            "Could not analyze claim."

        });

    }

  }
);


// ==================================================
// APPEALS
// ==================================================


// =============================================
// Get appeals
//
// /api/appeals
// -> ALL
//
// /api/appeals?view=pending
// -> PENDING
//
// /api/appeals?view=completed
// -> COMPLETED
// =============================================

app.get(
  "/api/appeals",
  (
    req,
    res
  ) => {

    try {

      const requestedView =
        String(
          req.query.view ||
          "all"
        )
          .trim()
          .toLowerCase();


      const view =

        requestedView ===
          "pending" ||

        requestedView ===
          "completed"

          ? requestedView

          : "all";


      const appeals =
        listAppeals(
          view
        );


      res.json({

        view,

        appeals,

        stats:
          getAppealStats()

      });

    } catch (
      error
    ) {

      console.error(
        "Appeal list error:",
        error
      );


      res
        .status(
          500
        )
        .json({

          error:
            "Could not load appeals."

        });

    }

  }
);


// =============================================
// Appeal statistics
// =============================================

app.get(
  "/api/appeals/stats",
  (
    req,
    res
  ) => {

    try {

      res.json(
        getAppealStats()
      );

    } catch (
      error
    ) {

      console.error(
        "Appeal stats error:",
        error
      );


      res
        .status(
          500
        )
        .json({

          error:
            "Could not load appeal statistics."

        });

    }

  }
);


// =============================================
// Get one appeal
// =============================================

app.get(
  "/api/appeals/:id",
  (
    req,
    res
  ) => {

    try {

      const appeal =
        getAppeal(
          req.params.id
        );


      if (
        !appeal
      ) {

        return res
          .status(
            404
          )
          .json({

            error:
              "Appeal not found."

          });

      }


      res.json(
        appeal
      );

    } catch (
      error
    ) {

      console.error(
        "Get appeal error:",
        error
      );


      res
        .status(
          500
        )
        .json({

          error:
            "Could not load appeal."

        });

    }

  }
);


// =============================================
// Get all appeals for one original claim
// =============================================

app.get(
  "/api/claims/:claimNumber/appeals",
  (
    req,
    res
  ) => {

    try {

      const claimNumber =
        String(
          req.params.claimNumber ||
          ""
        ).trim();


      const appeals =
        getAppealsForClaim(
          claimNumber
        );


      res.json({

        claimNumber,

        appeals

      });

    } catch (
      error
    ) {

      console.error(
        "Claim appeals lookup error:",
        error
      );


      res
        .status(
          500
        )
        .json({

          error:
            "Could not load appeals for this claim."

        });

    }

  }
);


// =============================================
// Analyze appeal
// =============================================

app.post(
  "/api/appeals/analyze",
  async (
    req,
    res
  ) => {

    try {

      // =======================================
      // Normalize appeal
      // =======================================

      const cleanAppeal =
        normalizeIncomingAppeal(
          req.body
        );


      // =======================================
      // Validate appeal
      // =======================================

      const validationError =
        validateAppeal(
          cleanAppeal
        );


      if (
        validationError
      ) {

        return res
          .status(
            400
          )
          .json({

            error:
              validationError

          });

      }


      console.log(
        `Analyzing appeal for claim ${cleanAppeal.claimNumber}...`
      );


      // =======================================
      // FIND ORIGINAL CLAIM
      //
      // IMPORTANT:
      //
      // If claimNumber exists more than once,
      // db.js returns the newest stored version.
      // =======================================

      const originalClaim =
        getLatestClaimByClaimNumber(
          cleanAppeal.claimNumber
        );


      if (
        !originalClaim
      ) {

        return res
          .status(
            404
          )
          .json({

            error:
              `Original claim ${cleanAppeal.claimNumber} was not found.`

          });

      }


      // =======================================
      // Optional provider consistency check
      //
      // We do NOT reject if the appeal omitted
      // providerName. We can inherit the original.
      // =======================================

      if (
        !cleanAppeal.providerName
      ) {

        cleanAppeal.providerName =
          originalClaim.providerName ||
          "";

      }


      // =======================================
      // ORCHESTRATION
      //
      // Deterministic re-check, AI evidence
      // comparison, reconciliation, and routing all
      // live in the appeal orchestrator.
      // =======================================

      const decision =
        await orchestrateAppeal(
          originalClaim,
          cleanAppeal
        );


      const rulesReview =
        decision.rulesReview;


      const aiReview =
        decision.aiReview;


      const finalOutcome =
        decision.finalOutcome;


      // =======================================
      // SAVE APPEAL
      // =======================================

      const savedAppeal =
        createAppeal(
          originalClaim,
          cleanAppeal,
          {

            rulesReview,

            aiReview,

            finalOutcome

          }
        );


      console.log(
        `Appeal for ${cleanAppeal.claimNumber} saved with final outcome: ${finalOutcome}`
      );


      // =======================================
      // IMPORTANT:
      //
      // Appeals do NOT trigger Vapi calls.
      //
      // Vapi remains attached to the original
      // claim review workflow only.
      // =======================================


      res
        .status(
          201
        )
        .json({

          appeal:
            savedAppeal,

          originalClaim: {

            id:
              originalClaim.id,

            claimNumber:
              originalClaim.claimNumber,

            providerName:
              originalClaim.providerName,

            riskLevel:
              originalClaim.riskLevel,

            flags:
              originalClaim.flags

          },

          review: {

            rules:
              rulesReview,

            ai:
              aiReview,

            finalOutcome,

            workflowStatus:
              decision.workflowStatus

          }

        });

    } catch (
      error
    ) {

      console.error(
        "Analyze appeal error:",
        error
      );


      res
        .status(
          500
        )
        .json({

          error:
            error.message ||
            "Could not analyze appeal."

        });

    }

  }
);


// =============================================
// Vapi queue
// =============================================

app.get(
  "/api/vapi/queue",
  (
    req,
    res
  ) => {

    try {

      res.json(
        getVapiQueueStatus()
      );

    } catch (
      error
    ) {

      console.error(
        "Queue status error:",
        error
      );


      res
        .status(
          500
        )
        .json({

          error:
            "Could not load call queue."

        });

    }

  }
);


// =============================================
// Vapi calls for claim
// =============================================

app.get(
  "/api/vapi/calls/:claimNumber",
  (
    req,
    res
  ) => {

    try {

      const calls =
        getVapiCallsForClaim(
          req.params.claimNumber
        );


      res.json({

        calls

      });

    } catch (
      error
    ) {

      console.error(
        "Vapi calls lookup error:",
        error
      );


      res
        .status(
          500
        )
        .json({

          error:
            "Could not load clarification calls."

        });

    }

  }
);


// =============================================
// Optional Vapi webhook
//
// Polling works without this.
// =============================================

app.post(
  "/api/vapi/webhook",
  (
    req,
    res
  ) => {

    try {

      const event =
        req.body;


      const message =
        event.message ||
        event;


      const type =
        message.type;


      const call =
        message.call ||
        event.call;


      const callId =

        call?.id ||

        message.callId;


      if (
        !callId
      ) {

        return res.json({

          received:
            true

        });

      }


      // =======================================
      // Status update
      // =======================================

      if (
        type ===
        "status-update"
      ) {

        try {

          updateVapiCallStatus(

            callId,

            message.status ||
              call?.status ||
              "in-progress"

          );

        } catch (
          error
        ) {

          console.error(
            "Webhook status error:",
            error.message
          );

        }

      }


      // =======================================
      // End-of-call report
      // =======================================

      if (
        type ===
        "end-of-call-report"
      ) {

        try {

          const artifact =

            message.artifact ||

            call?.artifact ||

            {};


          const transcript =
            normalizeTranscript(

              artifact.transcript ||

              message.transcript ||

              ""

            );


          completeVapiCall(
            callId,
            {

              status:
                call?.status ||
                "ended",

              endedReason:
                message.endedReason ||
                call?.endedReason ||
                null,

              transcript,

              messages:
                artifact.messages ||
                message.messages ||
                [],

              startedAt:
                call?.startedAt ||
                null,

              endedAt:
                call?.endedAt ||
                new Date()
                  .toISOString()

            }
          );

        } catch (
          error
        ) {

          console.error(
            "Webhook completion error:",
            error.message
          );

        }

      }


      res.json({

        received:
          true

      });

    } catch (
      error
    ) {

      console.error(
        "Webhook error:",
        error
      );


      res
        .status(
          500
        )
        .json({

          error:
            "Webhook processing failed."

        });

    }

  }
);


// =============================================
// Health
// =============================================

app.get(
  "/api/health",
  (
    req,
    res
  ) => {

    res.json({

      ok:
        true,

      aiKeyLoaded:
        Boolean(
          process.env
            .OPENAI_API_KEY
        ),

      aiModel:
        process.env
          .OPENAI_MODEL ||
        null,

      autoCall:
        process.env
          .DEMO_AUTO_CALL ===
        "true",

      appeals:
        true

    });

  }
);


// =============================================
// Start
// =============================================

app.listen(
  PORT,
  () => {

    console.log(
      `Claim Integrity running at http://localhost:${PORT}`
    );


    console.log(
      `AI key loaded: ${Boolean(
        process.env.OPENAI_API_KEY
      )}`
    );


    console.log(
      `AI model: ${
        process.env.OPENAI_MODEL ||
        "default"
      }`
    );


    console.log(
      `Vapi auto call: ${
        process.env
          .DEMO_AUTO_CALL ===
        "true"

          ? "enabled"

          : "disabled"
      }`
    );


    // =========================================
    // Vapi credential check
    //
    // vapi.js needs all four of these before it
    // will place a call. Without them a claim is
    // still analyzed, saved and routed; only the
    // clarification call is skipped.
    //
    // Names only. Never print a credential value.
    // =========================================

    if (
      process.env
        .DEMO_AUTO_CALL ===
      "true"
    ) {

      const missingVapiSettings =
        [
          "VAPI_API_KEY",
          "VAPI_ASSISTANT_ID",
          "VAPI_PHONE_NUMBER_ID",
          "DEMO_BILLING_CONTACT"
        ].filter(
          (name) =>
            !process.env[name]
        );


      console.log(
        missingVapiSettings.length ===
        0

          ? "Vapi credentials: complete"

          : `Vapi credentials: MISSING ${
              missingVapiSettings.join(", ")
            } - claims will be analyzed but calls will be skipped`
      );

    }


    console.log(
      "Appeal review: enabled"
    );

  }
);