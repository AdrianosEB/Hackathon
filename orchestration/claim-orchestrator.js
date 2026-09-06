// ==================================================
// CLAIM ORCHESTRATOR
//
// Runs the first stage of the workflow:
//
//   analyzer.js      deterministic rules
//   ai-reviewer.js   AI evidence review
//   -> merge         one combined finding list
//   -> route         clear, review, or priority review
//
// This module owns the merge. It used to live inline
// in server.js, which meant the HTTP handler was the
// only place the two opinions were ever combined and
// nothing else could reuse or test it.
//
// BOUNDARY:
//
// Nothing here determines fraud, approves or denies a
// claim, or makes a medical judgement. It decides
// which claims a human should look at, and in what
// order.
// ==================================================

import {
  analyzeClaim
} from "../analyzer.js";

import {
  reviewClaimWithAI
} from "../ai-reviewer.js";

import {
  runReviewPipeline
} from "./pipeline.js";


// --------------------------------------------------
// Severity ladder
//
// high > medium > low
//
// The merge may only ever move a flag UP this ladder.
// AI is allowed to raise concern about a deterministic
// finding; it is not allowed to talk one away.
// --------------------------------------------------

const SEVERITY_RANK = {

  low:
    0,

  medium:
    1,

  high:
    2

};


// --------------------------------------------------
// Risk level from the merged flag list
//
// Highest surviving severity wins.
// --------------------------------------------------

export function deriveRiskLevelFromFlags(
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


// --------------------------------------------------
// AI reason -> deterministic finding type affinity
//
// When AI and rules both speak about the same
// procedure code, this decides WHICH deterministic
// finding the AI opinion is attached to.
//
// Without it, a code carrying two rule findings
// (say a duplicate AND a price outlier) would collect
// every AI opinion on the first flag, and each new one
// would overwrite the last.
// --------------------------------------------------

const REASON_AFFINITY = {

  duplicate_service:
    ["duplicate"],

  unusual_billing:
    ["price_outlier", "quantity"],

  documentation_mismatch:
    ["documentation", "missing_context"],

  missing_support:
    ["documentation", "missing_context"],

  explicit_contradiction:
    ["documentation", "duplicate", "price_outlier", "quantity"],

  needs_review:
    []

};


// --------------------------------------------------
// Convert a standalone AI finding into a flag
// --------------------------------------------------

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


// --------------------------------------------------
// Pick the deterministic flag an AI finding belongs to
//
// Order of preference:
//
//   1. same line code AND a compatible finding type
//   2. same line code, any still-unclaimed flag
//   3. nothing -> the AI finding stands on its own
//
// Two rules keep opinions from overwriting each other:
//
//   - a flag is claimed at most once, so two AI
//     findings never collapse into one flag
//
//   - only DETERMINISTIC flags are candidates. An
//     ai-only flag appended earlier in this same merge
//     must not become a target for a later finding,
//     or its opinion would be overwritten too.
// --------------------------------------------------

function findFlagForAiFinding(
  candidates,
  claimed,
  aiFinding
) {

  const lineCode =
    String(
      aiFinding.lineCode ||
      ""
    ).trim();


  // Claim-level AI findings are never merged into a
  // line-level deterministic finding.

  if (
    !lineCode
  ) {

    return null;

  }


  const available =
    candidates.filter(
      (candidate) =>

        !claimed.has(
          candidate.index
        ) &&

        candidate.flag.lineCode ===
          lineCode
    );


  if (
    available.length ===
    0
  ) {

    return null;

  }


  const affinity =
    REASON_AFFINITY[
      aiFinding.reason
    ] ||
    [];


  const preferred =
    available.find(
      (candidate) =>
        affinity.includes(
          candidate.flag.type
        )
    );


  return preferred ||
    available[0];

}


// ==================================================
// MERGE RULES + AI FINDINGS
//
// Mutates analysis.flags in place, as the previous
// server.js version did, so stored claims keep the
// same shape.
// ==================================================

export function mergeAiFindings(
  analysis,
  aiReview
) {

  if (
    !aiReview?.available
  ) {

    return analysis;

  }


  const aiFindings =

    Array.isArray(
      aiReview.findings
    )
      ? aiReview.findings
      : [];


  // Snapshot the deterministic flags BEFORE merging.
  // Anything appended below is not a merge target.

  const candidates =
    analysis.flags.map(
      (flag, index) => ({
        flag,
        index
      })
    );


  const claimed =
    new Set();


  for (
    const aiFinding
    of aiFindings
  ) {

    const match =
      findFlagForAiFinding(
        candidates,
        claimed,
        aiFinding
      );


    if (
      !match
    ) {

      analysis.flags.push(
        normalizeAiFinding(
          aiFinding
        )
      );


      continue;

    }


    claimed.add(
      match.index
    );


    const matchingFlag =
      match.flag;


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


    // ----------------------------------------------
    // Escalate only.
    // ----------------------------------------------

    const currentRank =
      SEVERITY_RANK[
        matchingFlag.severity
      ] ??
      0;


    const aiRank =
      SEVERITY_RANK[
        aiFinding.severity
      ] ??
      0;


    if (
      aiRank >
      currentRank
    ) {

      matchingFlag.severity =
        aiFinding.severity;

    }

  }


  return analysis;

}


// ==================================================
// ORCHESTRATE ONE CLAIM
// ==================================================

export async function orchestrateClaim(
  claim,
  {
    logger =
      console
  } = {}
) {

  const decision =
    await runReviewPipeline({

      stage:
        "claim",

      subject:
        claim.claimNumber ||
        "(unnumbered claim)",

      logger,


      // --------------------------------------------
      // Deterministic rules
      // --------------------------------------------

      runRules:
        () => {

          const analysis =
            analyzeClaim(
              claim
            );


          // Older analyzer output and hand-built
          // fixtures may omit detectedBy.

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


          analysis.rulesRiskLevel =
            deriveRiskLevelFromFlags(
              analysis.flags
            );


          return analysis;

        },


      // --------------------------------------------
      // AI evidence review
      // --------------------------------------------

      runAi:
        () =>
          reviewClaimWithAI(
            claim
          ),


      aiUnavailable:
        (reason) => ({

          available:
            false,

          riskScore:
            0,

          riskLevel:
            "unavailable",

          summary:
            "AI evidence review unavailable.",

          findings:
            [],

          error:
            reason

        }),


      // --------------------------------------------
      // Reconcile
      //
      // The two reviewers stay independently visible
      // (rulesRiskLevel / aiRiskLevel) and the merged
      // flag list produces the level that routes.
      // --------------------------------------------

      reconcile:
        ({
          rules,
          ai
        }) => {

          const rulesRiskLevel =
            rules.rulesRiskLevel;


          const aiRiskLevel =

            ai.available

              ? deriveRiskLevelFromFlags(
                  ai.findings ||
                  []
                )

              : "unavailable";


          mergeAiFindings(
            rules,
            ai
          );


          const riskLevel =
            deriveRiskLevelFromFlags(
              rules.flags
            );


          return {

            headline:
              `risk=${riskLevel}`,

            riskLevel,

            rulesRiskLevel,

            aiRiskLevel,

            flags:
              rules.flags

          };

        },


      // --------------------------------------------
      // Route
      // --------------------------------------------

      route:
        ({
          verdict
        }) => {

          if (
            verdict.riskLevel ===
            "high"
          ) {

            return {

              nextStep:
                "priority_human_review",

              needsHumanReview:
                true,

              shouldCallProvider:
                true

            };

          }


          if (
            verdict.riskLevel ===
            "review"
          ) {

            return {

              nextStep:
                "human_review",

              needsHumanReview:
                true,

              shouldCallProvider:
                true

            };

          }


          return {

            nextStep:
              "auto_clear",

            needsHumanReview:
              false,

            shouldCallProvider:
              false

          };

        }

    });


  // ------------------------------------------------
  // Analysis record
  //
  // Shaped exactly the way db.createClaim and the
  // frontend already expect it.
  // ------------------------------------------------

  const analysis =
    decision.rules;


  analysis.rulesRiskLevel =
    decision.verdict.rulesRiskLevel;

  analysis.aiRiskLevel =
    decision.verdict.aiRiskLevel;

  analysis.riskLevel =
    decision.verdict.riskLevel;

  analysis.aiAvailable =
    decision.ai.available ===
    true;

  analysis.analysisMode =
    decision.mode;


  decision.analysis =
    analysis;


  return decision;

}
