import "dotenv/config";

import express from "express";

import {
  analyzeClaim
} from "./analyzer.js";

import {
  reviewClaimWithAI
} from "./ai-reviewer.js";

import {
  triggerVapiClarification
} from "./vapi.js";

import {
  createClaim,
  getClaim,
  listClaims,
  getDashboardStats,
  createVapiCall,
  updateVapiCallStatus,
  completeVapiCall,
  getVapiCallsForClaim
} from "./db.js";



// =============================================
// Express setup
// =============================================

const app =
  express();


const PORT =
  process.env.PORT ||
  3000;


app.use(
  express.json({
    limit: "1mb"
  })
);


app.use(
  express.static(
    "website"
  )
);



// =============================================
// Prevent duplicate calls during one server run
// =============================================

const autoCalledClaims =
  new Set();



// =============================================
// Severity ranking
// =============================================

const SEVERITY_RANK = {

  low:
    1,

  medium:
    2,

  high:
    3

};



// =============================================
// Convert findings into an overall rating
//
// HIGH finding   -> high
// MEDIUM finding -> review
// otherwise      -> low
// =============================================

function deriveRiskLevelFromFlags(
  flags = []
) {

  if (
    flags.some(
      (flag) =>
        flag.severity === "high"
    )
  ) {

    return "high";

  }


  if (
    flags.some(
      (flag) =>
        flag.severity === "medium"
    )
  ) {

    return "review";

  }


  return "low";

}



// =============================================
// Normalize claim input
// =============================================

function cleanClaimInput(
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

      Array.isArray(
        claim.diagnosisCodes
      )

        ? claim.diagnosisCodes
            .map(
              (code) =>
                String(code)
                  .trim()
            )
            .filter(Boolean)

        : [],

    clinicalNote:
      String(
        claim.clinicalNote ||
        ""
      ).trim(),

    lineItems:

      Array.isArray(
        claim.lineItems
      )

        ? claim.lineItems.map(
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
// Validate claim
// =============================================

function validateClaim(
  claim
) {

  const errors =
    [];


  if (
    !claim.claimNumber
  ) {

    errors.push(
      "Claim number is required."
    );

  }


  if (
    !claim.providerName
  ) {

    errors.push(
      "Provider name is required."
    );

  }


  if (
    !Array.isArray(
      claim.lineItems
    ) ||
    claim.lineItems.length === 0
  ) {

    errors.push(
      "At least one claim line is required."
    );

  }


  claim.lineItems.forEach(
    (item, index) => {

      if (
        !item.code
      ) {

        errors.push(
          `Line ${index + 1}: procedure code is required.`
        );

      }


      if (
        !Number.isFinite(
          item.units
        ) ||
        item.units <= 0
      ) {

        errors.push(
          `Line ${index + 1}: units must be greater than zero.`
        );

      }


      if (
        !Number.isFinite(
          item.amount
        ) ||
        item.amount < 0
      ) {

        errors.push(
          `Line ${index + 1}: amount must be zero or greater.`
        );

      }

    }
  );


  return errors;

}



// =============================================
// Merge AI findings into rule findings
// =============================================

function mergeAiFindings(
  analysis,
  aiReview
) {

  if (
    !aiReview.available ||
    !Array.isArray(
      aiReview.findings
    )
  ) {

    return;

  }


  for (
    const aiFinding
    of aiReview.findings
  ) {

    const matchingRuleFinding =
      analysis.flags.find(
        (flag) =>
          flag.lineCode &&
          aiFinding.lineCode &&
          flag.lineCode ===
            aiFinding.lineCode
      );


    if (
      matchingRuleFinding
    ) {

      // -----------------------------------------
      // Mark finding as detected by AI too
      // -----------------------------------------

      if (
        !Array.isArray(
          matchingRuleFinding.detectedBy
        )
      ) {

        matchingRuleFinding.detectedBy =
          ["rules"];

      }


      if (
        !matchingRuleFinding
          .detectedBy
          .includes("ai")
      ) {

        matchingRuleFinding
          .detectedBy
          .push("ai");

      }



      // -----------------------------------------
      // Store AI's separate review
      // -----------------------------------------

      matchingRuleFinding.aiReview = {

        severity:
          aiFinding.severity,

        reason:
          aiFinding.reason,

        message:
          aiFinding.message,

        evidence:
          aiFinding.evidence

      };



      // -----------------------------------------
      // Promote merged finding if AI rated it
      // more severely
      // -----------------------------------------

      const ruleRank =
        SEVERITY_RANK[
          matchingRuleFinding.severity
        ] ||
        0;


      const aiRank =
        SEVERITY_RANK[
          aiFinding.severity
        ] ||
        0;


      if (
        aiRank >
        ruleRank
      ) {

        matchingRuleFinding.severity =
          aiFinding.severity;

      }

    } else {

      // -----------------------------------------
      // AI-only finding
      // -----------------------------------------

      analysis.flags.push({

        type:
          "ai_review",

        severity:
          aiFinding.severity,

        lineCode:
          aiFinding.lineCode ||
          null,

        message:
          aiFinding.message,

        evidence:
          aiFinding.evidence,

        detectedBy:
          ["ai"],

        aiReview: {

          severity:
            aiFinding.severity,

          reason:
            aiFinding.reason,

          message:
            aiFinding.message,

          evidence:
            aiFinding.evidence

        }

      });

    }

  }

}



// =============================================
// Health
// =============================================

app.get(
  "/api/health",
  (req, res) => {

    res.json({

      ok:
        true,

      service:
        "claim-integrity"

    });

  }
);



// =============================================
// AI test
// =============================================

app.get(
  "/api/test-ai",
  async (req, res) => {

    try {

      if (
        !process.env
          .OPENAI_API_KEY
      ) {

        return res
          .status(500)
          .json({

            ok:
              false,

            error:
              "OPENAI_API_KEY is missing."

          });

      }


      const result =
        await reviewClaimWithAI({

          claimNumber:
            "TEST-AI",

          providerName:
            "Synthetic Test Provider",

          patientLabel:
            "Patient Test",

          diagnosisCodes:
            ["R10.9"],

          clinicalNote:
            "Synthetic test claim.",

          lineItems: [

            {

              code:
                "99213",

              description:
                "Office visit",

              serviceDate:
                "2026-09-05",

              units:
                1,

              amount:
                110

            }

          ]

        });


      return res.json({

        ok:
          true,

        result

      });

    } catch (error) {

      console.error(
        "AI test failed:",
        error
      );


      return res
        .status(500)
        .json({

          ok:
            false,

          error:
            error.message

        });

    }

  }
);



// =============================================
// Analyze claim
// =============================================

app.post(
  "/api/claims/analyze",
  async (req, res) => {

    try {

      const cleanClaim =
        cleanClaimInput(
          req.body
        );


      const errors =
        validateClaim(
          cleanClaim
        );


      if (
        errors.length > 0
      ) {

        return res
          .status(400)
          .json({

            errors

          });

      }



      // =========================================
      // 1. DETERMINISTIC RULES
      // =========================================

      const analysis =
        analyzeClaim(
          cleanClaim
        );


      analysis.flags =
        analysis.flags.map(
          (flag) => ({

            ...flag,

            detectedBy:

              Array.isArray(
                flag.detectedBy
              )

                ? flag.detectedBy

                : ["rules"]

          })
        );



      // =========================================
      // Calculate RULES rating BEFORE AI merge
      // =========================================

      const rulesRiskLevel =
        deriveRiskLevelFromFlags(
          analysis.flags
        );


      console.log(
        `Rules rating for ${cleanClaim.claimNumber}: ${rulesRiskLevel}`
      );



      // =========================================
      // 2. AI REVIEW
      // =========================================

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


        console.log(
          `AI review complete. ${
            aiReview.findings?.length ||
            0
          } finding(s).`
        );

      } catch (error) {

        console.error(
          "AI review failed:",
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



      // =========================================
      // Calculate AI rating independently
      // BEFORE merging with rules
      // =========================================

      const aiRiskLevel =

        aiReview.available

          ? deriveRiskLevelFromFlags(
              aiReview.findings ||
              []
            )

          : "unavailable";


      console.log(
        `AI rating for ${cleanClaim.claimNumber}: ${aiRiskLevel}`
      );



      // =========================================
      // 3. MERGE RULES + AI
      // =========================================

      mergeAiFindings(
        analysis,
        aiReview
      );



      // =========================================
      // 4. FINAL HYBRID RATING
      //
      // Highest merged finding wins.
      // =========================================

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


      console.log(
        `Final rating for ${cleanClaim.claimNumber}: ${finalRiskLevel}`
      );



      // =========================================
      // 5. VAPI
      //
      // Only FINAL HIGH claims trigger a call.
      // =========================================

      let clarificationCall = {

        triggered:
          false,

        reason:
          "not_required"

      };


      if (
        analysis.riskLevel ===
        "high"
      ) {

        if (
          autoCalledClaims.has(
            cleanClaim.claimNumber
          )
        ) {

          clarificationCall = {

            triggered:
              false,

            reason:
              "already_called"

          };


          console.log(
            `Clarification already triggered for ${cleanClaim.claimNumber}.`
          );

        } else {

          try {

            clarificationCall =
              await triggerVapiClarification(
                cleanClaim,
                analysis
              );


            if (
              clarificationCall
                .triggered
            ) {

              autoCalledClaims.add(
                cleanClaim.claimNumber
              );

            }


            if (
              clarificationCall
                .callId
            ) {

              createVapiCall(
                cleanClaim.claimNumber,
                clarificationCall.callId,
                clarificationCall.status ||
                  "created"
              );

            }

          } catch (error) {

            console.error(
              "Vapi clarification failed:",
              error.message
            );


            clarificationCall = {

              triggered:
                false,

              reason:
                "vapi_error",

              error:
                error.message

            };

          }

        }

      }


      analysis.clarificationCall =
        clarificationCall;



      // =========================================
      // 6. SAVE CLAIM
      // =========================================

      const storedClaim =
        createClaim(
          cleanClaim,
          analysis
        );



      // =========================================
      // 7. RETURN RESULT
      // =========================================

      return res.json({

        ...storedClaim,

        rulesRiskLevel:
          analysis.rulesRiskLevel,

        aiRiskLevel:
          analysis.aiRiskLevel,

        riskLevel:
          analysis.riskLevel,

        aiAvailable:
          analysis.aiAvailable,

        analysisMode:
          analysis.analysisMode,

        clarificationCall:
          analysis.clarificationCall

      });

    } catch (error) {

      console.error(
        "Claim analysis failed:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            error.message

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

      const id =
        Number(
          req.params.id
        );


      if (
        !Number.isInteger(id)
      ) {

        return res
          .status(400)
          .json({

            error:
              "Invalid claim ID."

          });

      }


      const claim =
        getClaim(
          id
        );


      if (
        !claim
      ) {

        return res
          .status(404)
          .json({

            error:
              "Claim not found."

          });

      }


      return res.json(
        claim
      );

    } catch (error) {

      console.error(
        "Could not load claim:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);



// =============================================
// List claims
// =============================================

app.get(
  "/api/claims",
  (req, res) => {

    try {

      return res.json(
        listClaims()
      );

    } catch (error) {

      console.error(
        "Could not list claims:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);



// =============================================
// Dashboard
// =============================================

app.get(
  "/api/dashboard",
  (req, res) => {

    try {

      const claims =
        listClaims();


      const stats =
        getDashboardStats();


      return res.json({

        ...stats,

        claims

      });

    } catch (error) {

      console.error(
        "Dashboard failed:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);



// =============================================
// Get Vapi calls for claim
// =============================================

app.get(
  "/api/vapi/calls/:claimNumber",
  (req, res) => {

    try {

      const claimNumber =
        String(
          req.params
            .claimNumber ||
          ""
        );


      const calls =
        getVapiCallsForClaim(
          claimNumber
        );


      return res.json(
        calls
      );

    } catch (error) {

      console.error(
        "Could not load Vapi calls:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);



// =============================================
// Vapi webhook
// =============================================

app.post(
  "/api/vapi/webhook",
  (req, res) => {

    try {

      const message =
        req.body?.message;


      if (
        !message
      ) {

        return res
          .status(400)
          .json({

            error:
              "Missing Vapi message."

          });

      }


      console.log(
        `Vapi webhook received: ${message.type}`
      );



      // =========================================
      // Status update
      // =========================================

      if (
        message.type ===
        "status-update"
      ) {

        const callId =
          message.call?.id;


        const status =
          message.status ||
          message.call?.status;


        if (
          callId &&
          status
        ) {

          updateVapiCallStatus(
            callId,
            status
          );


          console.log(
            `Vapi call ${callId}: ${status}`
          );

        }

      }



      // =========================================
      // End of call
      // =========================================

      if (
        message.type ===
        "end-of-call-report"
      ) {

        const callId =
          message.call?.id;


        if (
          !callId
        ) {

          return res
            .status(400)
            .json({

              error:
                "Missing call ID."

            });

        }


        const transcript =

          message
            .artifact
            ?.transcript ||

          message
            .transcript ||

          "";


        const messages =

          message
            .artifact
            ?.messages ||

          message
            .messages ||

          [];


        const endedReason =

          message
            .endedReason ||

          message
            .call
            ?.endedReason ||

          null;


        const startedAt =

          message
            .startedAt ||

          message
            .call
            ?.startedAt ||

          null;


        const endedAt =

          message
            .endedAt ||

          message
            .call
            ?.endedAt ||

          null;


        completeVapiCall(
          callId,
          {

            status:
              "ended",

            endedReason,

            transcript,

            messages,

            startedAt,

            endedAt

          }
        );


        console.log(
          `Vapi call completed: ${callId}`
        );


        console.log(
          `Transcript saved: ${Boolean(
            transcript
          )}`
        );

      }


      return res
        .status(200)
        .json({

          received:
            true

        });

    } catch (error) {

      console.error(
        "Vapi webhook error:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);



// =============================================
// Start server
// =============================================

app.listen(
  PORT,
  () => {

    console.log(
      `Claim Integrity running at http://localhost:${PORT}`
    );


    console.log(
      "AI key loaded:",
      Boolean(
        process.env
          .OPENAI_API_KEY
      )
    );


    console.log(
      "AI model:",
      process.env
        .OPENAI_MODEL ||
        "gpt-5.6-luna"
    );


    console.log(
      "Vapi auto call:",
      process.env
        .DEMO_AUTO_CALL ===
        "true"
    );


    console.log(
      "Vapi webhook endpoint: /api/vapi/webhook"
    );

  }
);