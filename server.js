import "dotenv/config";

import express from "express";

import {
  analyzeClaim
} from "./analyzer.js";

import {
  reviewClaimWithAI
} from "./ai-reviewer.js";

import {
  analyzeAppeal
} from "./appeal-analyzer.js";

import {
  reviewAppealWithAI
} from "./appeal-ai-reviewer.js";

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
// Merge claim Rules + AI findings
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
// Final appeal outcome
//
// RULES and AI remain independent reviewers.
//
// Dashboard mapping:
//
// resolved
// -> COMPLETED
//
// partially_resolved
// -> PENDING
//
// not_resolved
// -> PENDING
//
// IMPORTANT:
//
// A deterministic contradiction that remains should
// not be completely cleared merely because AI says
// resolved.
// =============================================

function deriveFinalAppealOutcome(
  rulesReview,
  aiReview
) {

  const rulesOutcome =
    rulesReview?.outcome ||
    "not_resolved";


  // ===========================================
  // If OpenAI is unavailable, deterministic
  // appeal review still works.
  // ===========================================

  if (
    !aiReview?.available
  ) {

    return rulesOutcome;

  }


  const aiOutcome =
    aiReview.outcome ||
    "not_resolved";


  // ===========================================
  // Both reviewers fully resolved everything.
  // ===========================================

  if (
    rulesOutcome ===
      "resolved" &&

    aiOutcome ===
      "resolved"
  ) {

    return "resolved";

  }


  // ===========================================
  // Deterministic contradiction remains.
  //
  // If AI says fully resolved, that means there
  // was meaningful appeal evidence, but an
  // objective Rules condition still remains.
  //
  // Therefore the best final result is partial.
  // ===========================================

  if (
    rulesOutcome ===
      "not_resolved"
  ) {

    if (
      aiOutcome ===
      "resolved"
    ) {

      return "partially_resolved";

    }


    if (
      aiOutcome ===
      "partially_resolved"
    ) {

      return "not_resolved";

    }


    return "not_resolved";

  }


  // ===========================================
  // Rules found meaningful partial correction.
  // The overall appeal cannot be completed yet.
  // ===========================================

  if (
    rulesOutcome ===
      "partially_resolved"
  ) {

    return "partially_resolved";

  }


  // ===========================================
  // Rules are completely resolved.
  //
  // AI determines whether original evidentiary
  // concerns remain.
  // ===========================================

  if (
    rulesOutcome ===
      "resolved"
  ) {

    if (
      aiOutcome ===
      "partially_resolved"
    ) {

      return "partially_resolved";

    }


    if (
      aiOutcome ===
      "not_resolved"
    ) {

      return "not_resolved";

    }


    return "resolved";

  }


  return "not_resolved";

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


      console.log(
        `Analyzing claim ${cleanClaim.claimNumber}...`
      );


      // =======================================
      // RULES
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
      // MERGE CLAIM RULES + AI
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
      // REVIEW + HIGH ENTER VAPI QUEUE
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
              // CALL STARTED
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
              // POLLING UPDATE
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
              // CALL COMPLETED
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
              // CALL FAILED
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
      // DETERMINISTIC APPEAL REVIEW
      // =======================================

      console.log(
        `Running deterministic appeal review for ${cleanAppeal.claimNumber}...`
      );


      const rulesReview =
        analyzeAppeal(
          originalClaim,
          cleanAppeal
        );


      console.log(
        `Appeal Rules outcome for ${cleanAppeal.claimNumber}: ${rulesReview.outcome}`
      );


      // =======================================
      // AI APPEAL REVIEW
      // =======================================

      let aiReview = {

        available:
          false,

        outcome:
          "unavailable",

        summary:
          "AI appeal evidence review unavailable.",

        results:
          []

      };


      try {

        console.log(
          `Running AI appeal review for ${cleanAppeal.claimNumber}...`
        );


        aiReview =
          await reviewAppealWithAI(
            originalClaim,
            cleanAppeal
          );


        if (
          aiReview.available
        ) {

          console.log(
            `Appeal AI outcome for ${cleanAppeal.claimNumber}: ${aiReview.outcome}`
          );

        } else {

          console.log(
            `Appeal AI unavailable for ${cleanAppeal.claimNumber}. Using deterministic result.`
          );

        }

      } catch (
        error
      ) {

        console.error(
          "AI appeal review error:",
          error.message
        );


        aiReview = {

          available:
            false,

          outcome:
            "unavailable",

          summary:
            "AI appeal evidence review unavailable.",

          results:
            [],

          error:
            error.message

        };

      }


      // =======================================
      // FINAL APPEAL OUTCOME
      // =======================================

      const finalOutcome =
        deriveFinalAppealOutcome(
          rulesReview,
          aiReview
        );


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

              finalOutcome ===
                "resolved"

                ? "completed"

                : "pending"

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


    console.log(
      "Appeal review: enabled"
    );

  }
);