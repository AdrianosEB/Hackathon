import "dotenv/config";

import express from "express";

import {
  analyzeClaim
} from "./analyzer.js";

import {
  reviewClaimWithAI
} from "./ai-reviewer.js";

import {
  queueVapiCall,
  getVapiQueueStatus
} from "./vapi.js";

import {
  createClaim,
  getClaim,
  listClaims,
  getDashboardStats,
  getProviderRiskStats,
  createVapiCall,
  updateVapiCallStatus,
  completeVapiCall,
  getVapiCallsForClaim
} from "./db.js";


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
// Risk helper
// =============================================

function deriveRiskLevelFromFlags(
  flags = []
) {

  if (
    flags.some(
      (flag) =>
        flag.severity ===
        "high"
    )
  ) {

    return "high";

  }


  if (
    flags.some(
      (flag) =>
        flag.severity ===
        "medium"
    )
  ) {

    return "review";

  }


  return "low";

}


// =============================================
// Normalize AI finding
// =============================================

function normalizeAiFinding(
  finding
) {

  return {

    lineCode:
      finding.lineCode ||
      "",

    severity:
      finding.severity ||
      "medium",

    type:
      finding.reason ||
      "needs_review",

    message:
      finding.message ||
      "",

    evidence:
      finding.evidence ||
      "",

    detectedBy:
      ["ai"],

    aiReview: {

      severity:
        finding.severity ||
        "medium",

      reason:
        finding.reason ||
        "needs_review",

      message:
        finding.message ||
        "",

      evidence:
        finding.evidence ||
        ""

    }

  };

}


// =============================================
// Merge rules + AI
// =============================================

function mergeAiFindings(
  analysis,
  aiReview
) {

  if (
    !aiReview?.available
  ) {

    return;

  }


  const aiFindings =

    Array.isArray(
      aiReview.findings
    )

      ? aiReview.findings

      : [];


  for (
    const aiFinding
    of aiFindings
  ) {

    const matchingFlag =
      analysis.flags.find(
        (flag) =>

          flag.lineCode &&

          aiFinding.lineCode &&

          flag.lineCode ===
            aiFinding.lineCode
      );


    if (
      matchingFlag
    ) {

      if (
        !Array.isArray(
          matchingFlag.detectedBy
        )
      ) {

        matchingFlag.detectedBy =
          ["rules"];

      }


      if (
        !matchingFlag.detectedBy.includes(
          "ai"
        )
      ) {

        matchingFlag.detectedBy.push(
          "ai"
        );

      }


      matchingFlag.aiReview = {

        severity:
          aiFinding.severity,

        reason:
          aiFinding.reason,

        message:
          aiFinding.message,

        evidence:
          aiFinding.evidence

      };


      if (
        aiFinding.severity ===
        "high"
      ) {

        matchingFlag.severity =
          "high";

      } else if (
        aiFinding.severity ===
          "medium" &&

        matchingFlag.severity !==
          "high"
      ) {

        matchingFlag.severity =
          "medium";

      }


      continue;

    }


    analysis.flags.push(
      normalizeAiFinding(
        aiFinding
      )
    );

  }

}


// =============================================
// Normalize incoming claim
// =============================================

function normalizeIncomingClaim(
  claim
) {

  const lineItems =

    Array.isArray(
      claim.lineItems
    )

      ? claim.lineItems

      : [];


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

      Array.isArray(
        claim.diagnosisCodes
      )

        ? claim.diagnosisCodes
            .map(
              (code) =>
                String(
                  code
                ).trim()
            )
            .filter(
              Boolean
            )

        : [],

    clinicalNote:
      String(
        claim.clinicalNote ||
        ""
      ).trim(),

    lineItems:
      lineItems.map(
        (item) => ({

          code:
            String(
              item.code ||
              ""
            ).trim(),

          description:
            String(
              item.description ||
              ""
            ).trim(),

          serviceDate:
            String(
              item.serviceDate ||
              ""
            ).trim(),

          units:
            Number(
              item.units ||
              0
            ),

          amount:
            Number(
              item.amount ||
              0
            )

        })
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
// Normalize Vapi transcript
// =============================================

function normalizeTranscript(
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


          return (
            `${speaker}: ${content}`
          );

        }
      )
      .join(
        "\n"
      );

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


// =============================================
// Dashboard
// =============================================

app.get(
  "/api/dashboard",
  (req, res) => {

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
  (req, res) => {

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
  (req, res) => {

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


      console.log(
        `Analyzing claim ${cleanClaim.claimNumber}...`
      );


      // =======================================
      // Rules
      // =======================================

      const analysis =
        analyzeClaim(
          cleanClaim
        );


      analysis.flags =

        Array.isArray(
          analysis.flags
        )

          ? analysis.flags.map(
              (flag) => ({

                ...flag,

                detectedBy:

                  Array.isArray(
                    flag.detectedBy
                  )

                    ? flag.detectedBy

                    : ["rules"]

              })
            )

          : [];


      const rulesRiskLevel =
        deriveRiskLevelFromFlags(
          analysis.flags
        );


      // =======================================
      // AI
      // =======================================

      let aiReview = {

        available:
          false,

        findings:
          []

      };


      try {

        console.log(
          `Running AI review for claim ${cleanClaim.claimNumber}...`
        );


        aiReview =
          await reviewClaimWithAI(
            cleanClaim
          );


        if (
          aiReview.available
        ) {

          console.log(
            `AI review complete. ${
              aiReview.findings
                ?.length ||
              0
            } finding(s).`
          );

        }

      } catch (
        error
      ) {

        console.error(
          "AI review error:",
          error.message
        );


        aiReview = {

          available:
            false,

          findings:
            [],

          error:
            error.message

        };

      }


      const aiRiskLevel =

        aiReview.available

          ? deriveRiskLevelFromFlags(
              aiReview.findings ||
              []
            )

          : "unavailable";


      // =======================================
      // Merge
      // =======================================

      mergeAiFindings(
        analysis,
        aiReview
      );


      const finalRiskLevel =
        deriveRiskLevelFromFlags(
          analysis.flags
        );


      analysis.rulesRiskLevel =
        rulesRiskLevel;


      analysis.aiRiskLevel =
        aiRiskLevel;


      analysis.riskLevel =
        finalRiskLevel;


      analysis.aiAvailable =
        aiReview.available ===
        true;


      analysis.analysisMode =

        aiReview.available

          ? "hybrid"

          : "rules";


      // =======================================
      // Save claim
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
      // REVIEW + HIGH enter Vapi queue
      // =======================================

      const shouldCall =

        finalRiskLevel ===
          "review" ||

        finalRiskLevel ===
          "high";


      if (
        shouldCall
      ) {

        const queueResult =
          queueVapiCall(

            cleanClaim,

            analysis.flags,

            {

              // =================================
              // Call started
              // =================================

              onStarted:
                async (
                  result
                ) => {

                  console.log(
                    `Clarification call started for ${cleanClaim.claimNumber}`
                  );


                  try {

                    createVapiCall(

                      cleanClaim
                        .claimNumber,

                      result.callId,

                      result.status ||
                        "created"

                    );

                  } catch (
                    databaseError
                  ) {

                    console.error(
                      "Could not save Vapi call:",
                      databaseError.message
                    );

                  }

                },


              // =================================
              // Polling update
              // =================================

              onUpdate:
                async (
                  call
                ) => {

                  try {

                    updateVapiCallStatus(

                      call.id,

                      call.status ||
                        "in-progress"

                    );

                  } catch (
                    databaseError
                  ) {

                    console.error(
                      "Could not update Vapi call:",
                      databaseError.message
                    );

                  }

                },


              // =================================
              // Call completed
              // =================================

              onCompleted:
                async (
                  call
                ) => {

                  try {

                    const rawTranscript =

                      call.artifact
                        ?.transcript ||

                      call.transcript ||

                      "";


                    const transcript =
                      normalizeTranscript(
                        rawTranscript
                      );


                    const messages =

                      call.artifact
                        ?.messages ||

                      call.messages ||

                      [];


                    completeVapiCall(
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
                    );


                    console.log(
                      `Clarification call completed for ${cleanClaim.claimNumber}`
                    );

                  } catch (
                    databaseError
                  ) {

                    console.error(
                      "Could not complete Vapi call:",
                      databaseError.message
                    );

                  }

                },


              // =================================
              // Failed
              // =================================

              onFailed:
                async (
                  error,
                  callId
                ) => {

                  console.error(
                    `Clarification call failed for ${cleanClaim.claimNumber}:`,
                    error.message
                  );


                  if (
                    callId
                  ) {

                    try {

                      updateVapiCallStatus(
                        callId,
                        "failed"
                      );

                    } catch (
                      databaseError
                    ) {

                      console.error(
                        "Could not save failed Vapi call:",
                        databaseError.message
                      );

                    }

                  }

                }

            }

          );


        console.log(
          `Vapi queue result for ${cleanClaim.claimNumber}:`,
          queueResult
        );

      }


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


// =============================================
// Vapi queue
// =============================================

app.get(
  "/api/vapi/queue",
  (req, res) => {

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
  (req, res) => {

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
// Keeping the route does no harm.
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
        "true"

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

  }
);