import "dotenv/config";
import express from "express";

import { reviewClaimWithAI } from "./ai-reviewer.js";
import { analyzeClaim } from "./analyzer.js";
import { triggerVapiClarification } from "./vapi.js";

import {
  createClaim,
  getClaim,
  listClaims,
  getDashboardStats
} from "./db.js";


// ==================================================
// App setup
// ==================================================

const app = express();

const PORT = Number(
  process.env.PORT || 3000
);


// ==================================================
// Hackathon safeguard
//
// Prevent the same claim number from automatically
// triggering multiple Vapi calls during this server
// session.
// ==================================================

const autoCalledClaims =
  new Set();


// ==================================================
// Middleware
// ==================================================

app.use(
  express.json({
    limit: "5mb"
  })
);


// Serve frontend
//
// The application assets live at the repository root. Serve only the public
// files explicitly so source files and local configuration are not exposed.

app.get(
  "/",
  (_req, res) => {

    res.sendFile(
      "index.html",
      {
        root: process.cwd()
      }
    );

  }
);


app.get(
  "/style.css",
  (_req, res) => {

    res.sendFile(
      "style.css",
      {
        root: process.cwd()
      }
    );

  }
);


app.get(
  "/script.js",
  (_req, res) => {

    res.sendFile(
      "script.js",
      {
        root: process.cwd()
      }
    );

  }
);


// ==================================================
// Health check
// ==================================================

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true
    });

  }
);


// ==================================================
// Get all claims
// ==================================================

app.get(
  "/api/claims",
  (req, res) => {

    const claims =
      listClaims();

    res.json(claims);

  }
);


// ==================================================
// Get one claim
// ==================================================

app.get(
  "/api/claims/:id",
  (req, res) => {

    const id =
      Number(req.params.id);


    const claim =
      getClaim(id);


    if (!claim) {

      return res
        .status(404)
        .json({
          error: "Claim not found."
        });

    }


    res.json(claim);

  }
);


// ==================================================
// Temporary AI test endpoint
//
// Remove this before final submission.
// ==================================================

app.get(
  "/api/test-ai",
  async (req, res) => {

    try {

      const demoClaim = {

        claimId:
          "DEMO-TEST",

        lines: [

          {

            id:
              "L1",

            code:
              "70551",

            service:
              "Brain MRI",

            amount:
              2400

          }

        ],

        documents: [

          {

            id:
              "DOC-1",

            text:
              "No imaging ordered today."

          }

        ]

      };


      const result =
        await reviewClaimWithAI(
          demoClaim
        );


      res.json(result);


    } catch (error) {

      console.error(
        "AI test failed:",
        error
      );


      res
        .status(500)
        .json({

          error:
            error.message

        });

    }

  }
);


// ==================================================
// Dashboard
// ==================================================

app.get(
  "/api/dashboard",
  (req, res) => {

    res.json({

      stats:
        getDashboardStats(),

      claims:
        listClaims(50)

    });

  }
);


// ==================================================
// Analyze claim
//
// FLOW:
//
// Browser
//   ↓
// Deterministic rules
//   ↓
// AI review
//   ↓
// Merge findings
//   ↓
// Check for HIGH anomaly
//   ↓
// Automatic Vapi clarification call
//   ↓
// Save result
// ==================================================

app.post(
  "/api/claims/analyze",
  async (req, res) => {

    try {

      const claim =
        req.body || {};


      // ============================================
      // STEP 1
      //
      // Validate input
      // ============================================

      const errors =
        validateClaim(claim);


      if (
        errors.length > 0
      ) {

        return res
          .status(400)
          .json({
            errors
          });

      }


      // ============================================
      // STEP 2
      //
      // Clean browser input
      // ============================================

      const cleanClaim = {

        claimNumber:
          String(
            claim.claimNumber
          ).trim(),

        providerName:
          String(
            claim.providerName
          ).trim(),

        patientLabel:
          String(
            claim.patientLabel || ""
          ).trim(),

        diagnosisCodes:
          Array.isArray(
            claim.diagnosisCodes
          )
            ? claim.diagnosisCodes.map(
                String
              )
            : [],

        clinicalNote:
          String(
            claim.clinicalNote || ""
          ).trim(),

        lineItems:
          claim.lineItems.map(
            (item) => ({

              code:
                String(
                  item.code || ""
                ).trim(),

              description:
                String(
                  item.description || ""
                ).trim(),

              serviceDate:
                String(
                  item.serviceDate || ""
                ).trim(),

              units:
                Number(
                  item.units || 1
                ),

              amount:
                Number(
                  item.amount || 0
                )

            })
          )

      };


      // ============================================
      // STEP 3
      //
      // Deterministic analyzer
      // ============================================

      const analysis =
        analyzeClaim(
          cleanClaim
        );


      // Mark existing findings as rule findings

      analysis.flags =
        analysis.flags.map(
          (flag) => ({

            ...flag,

            detectedBy: [
              "rules"
            ]

          })
        );


      // ============================================
      // STEP 4
      //
      // AI evidence reviewer
      // ============================================

      let aiResult = {

        available: false,

        findings: []

      };


      try {

        console.log(
          `Running AI review for claim ${cleanClaim.claimNumber}...`
        );


        aiResult =
          await reviewClaimWithAI(
            cleanClaim
          );


        console.log(
          `AI review complete. ${aiResult.findings?.length || 0} finding(s).`
        );


      } catch (error) {

        console.error(
          "AI review failed:",
          error.message
        );


        // AI failure does not stop deterministic
        // claim analysis.

        aiResult = {

          available: false,

          findings: []

        };

      }


      // ============================================
      // STEP 5
      //
      // Merge AI findings with rule findings
      // ============================================

      if (
        aiResult.available &&
        Array.isArray(
          aiResult.findings
        )
      ) {

        for (
          const aiFinding
          of aiResult.findings
        ) {

          const existingFlag =
            analysis.flags.find(
              (flag) =>
                flag.lineCode ===
                aiFinding.lineCode
            );


          // ----------------------------------------
          // Rules + AI found same procedure
          // ----------------------------------------

          if (existingFlag) {

            if (
              !existingFlag
                .detectedBy
                .includes("ai")
            ) {

              existingFlag
                .detectedBy
                .push("ai");

            }


            existingFlag.aiReview = {

              reason:
                aiFinding.reason,

              severity:
                aiFinding.severity,

              message:
                aiFinding.message,

              evidence:
                aiFinding.evidence

            };


          } else {

            // --------------------------------------
            // AI-only finding
            // --------------------------------------

            analysis.flags.push({

              type:
                aiFinding.reason,

              severity:
                aiFinding.severity,

              lineCode:
                aiFinding.lineCode,

              message:
                aiFinding.message,

              evidence:
                aiFinding.evidence,

              detectedBy: [
                "ai"
              ]

            });

          }

        }

      }


      // ============================================
      // STEP 6
      //
      // Record analysis mode
      // ============================================

      analysis.aiAvailable =
        aiResult.available;


      analysis.analysisMode =
        aiResult.available
          ? "hybrid"
          : "rules-only";


      // ============================================
      // STEP 7
      //
      // Determine whether automatic clarification
      // call should happen.
      //
      // Current rule:
      //
      // - At least one HIGH finding
      // - DEMO_AUTO_CALL=true
      // - Claim has not already been called
      // ============================================

      let clarificationCall = {

        triggered: false

      };


      const hasHighSeverityFinding =
        analysis.flags.some(
          (flag) =>
            flag.severity === "high"
        );


      const alreadyCalled =
        autoCalledClaims.has(
          cleanClaim.claimNumber
        );


      if (
        hasHighSeverityFinding &&
        !alreadyCalled
      ) {

        try {

          clarificationCall =
            await triggerVapiClarification(
              cleanClaim,
              analysis
            );


          if (
            clarificationCall.triggered
          ) {

            // Mark this claim as already called

            autoCalledClaims.add(
              cleanClaim.claimNumber
            );


            console.log(
              `Automatic clarification call triggered for ${cleanClaim.claimNumber}.`
            );


            console.log(
              `Vapi call ID: ${clarificationCall.callId || "unknown"}`
            );

          }


        } catch (error) {

          console.error(
            "Automatic Vapi call failed:",
            error.message
          );


          // IMPORTANT:
          //
          // The claim analysis should still succeed
          // even if Vapi fails.

          clarificationCall = {

            triggered: false,

            error:
              error.message

          };

        }


      } else if (alreadyCalled) {

        console.log(
          `Claim ${cleanClaim.claimNumber} already triggered a call. Skipping Vapi.`
        );


        clarificationCall = {

          triggered: false,

          reason:
            "already_called"

        };


      } else {

        console.log(
          `Claim ${cleanClaim.claimNumber} has no high-severity findings. No Vapi call triggered.`
        );


        clarificationCall = {

          triggered: false,

          reason:
            "no_high_severity_findings"

        };

      }


      // Attach call information to analysis

      analysis.clarificationCall =
        clarificationCall;


      // ============================================
      // STEP 8
      //
      // Save claim + analysis
      // ============================================

      const savedClaim =
        createClaim(
          cleanClaim,
          analysis
        );


      // ============================================
      // STEP 9
      //
      // Return everything to frontend
      // ============================================

      res
        .status(201)
        .json(savedClaim);


    } catch (error) {

      console.error(
        "Claim analysis failed:",
        error
      );


      res
        .status(500)
        .json({

          error:
            "Claim analysis failed.",

          details:
            error.message

        });

    }

  }
);


// ==================================================
// Validate claim input
// ==================================================

function validateClaim(
  claim
) {

  const errors = [];


  // ----------------------------------------------
  // Claim number
  // ----------------------------------------------

  if (
    !String(
      claim.claimNumber || ""
    ).trim()
  ) {

    errors.push(
      "Claim number is required."
    );

  }


  // ----------------------------------------------
  // Provider
  // ----------------------------------------------

  if (
    !String(
      claim.providerName || ""
    ).trim()
  ) {

    errors.push(
      "Provider name is required."
    );

  }


  // ----------------------------------------------
  // Line items
  // ----------------------------------------------

  if (
    !Array.isArray(
      claim.lineItems
    ) ||
    claim.lineItems.length === 0
  ) {

    errors.push(
      "At least one line item is required."
    );


  } else {

    claim.lineItems.forEach(
      (item, index) => {

        // Procedure code

        if (
          !String(
            item.code || ""
          ).trim()
        ) {

          errors.push(
            `Line ${index + 1}: procedure code is required.`
          );

        }


        // Amount

        if (
          !(
            Number(item.amount) >= 0
          )
        ) {

          errors.push(
            `Line ${index + 1}: amount must be a number.`
          );

        }

      }
    );

  }


  return errors;

}


// ==================================================
// Start server
// ==================================================

app.listen(
  PORT,
  () => {

    console.log(
      `Claim Integrity running at http://localhost:${PORT}`
    );


    console.log(
      `AI key loaded: ${Boolean(process.env.OPENAI_API_KEY)}`
    );


    console.log(
      `AI model: ${process.env.OPENAI_MODEL || "default"}`
    );


    console.log(
      `Vapi auto-call: ${process.env.DEMO_AUTO_CALL === "true" ? "ENABLED" : "DISABLED"}`
    );


    console.log(
      `Vapi configured: ${
        Boolean(
          process.env.VAPI_API_KEY &&
          process.env.VAPI_ASSISTANT_ID &&
          process.env.VAPI_PHONE_NUMBER_ID &&
          process.env.DEMO_BILLING_CONTACT
        )
      }`
    );

  }
);
