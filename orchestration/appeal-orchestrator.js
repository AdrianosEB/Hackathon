// ==================================================
// APPEAL ORCHESTRATOR
//
// Runs the second stage of the workflow:
//
//   appeal-analyzer.js     deterministic re-check
//   appeal-ai-reviewer.js  AI evidence comparison
//   -> reconcile           one final outcome
//   -> route               close, or back to a human
//
// Same pipeline as the claim stage. The difference is
// only in how the two opinions are reconciled:
//
//   CLAIM STAGE
//   the two reviewers ADD findings to a shared list,
//   and the worst surviving severity routes.
//
//   APPEAL STAGE
//   the two reviewers each judge the SAME original
//   findings, and the more conservative of the two
//   opinions routes.
//
// BOUNDARY:
//
// An appeal outcome is not a payment decision. It only
// answers "does the new evidence address the original
// finding?" and hands the result to a human.
// ==================================================

import {
  analyzeAppeal
} from "../appeal-analyzer.js";

import {
  reviewAppealWithAI
} from "../appeal-ai-reviewer.js";

import {
  runReviewPipeline
} from "./pipeline.js";


// --------------------------------------------------
// Reconciliation matrix
//
// rows    deterministic outcome
// columns AI outcome
//
// Read the table as: neither reviewer can be talked
// out of a concern by the other.
//
// The one asymmetry is deliberate:
//
//   rules not_resolved + AI resolved
//     -> partially_resolved
//
//     The appeal clearly contained meaningful new
//     evidence, so it is not treated as a non-appeal,
//     but an objective condition is still present in
//     the corrected data so it cannot be closed.
//
//   rules not_resolved + AI partially_resolved
//     -> not_resolved
//
//     Partial evidence plus an unchanged objective
//     condition is not meaningful progress.
// --------------------------------------------------

const OUTCOME_MATRIX = {

  resolved: {

    resolved:
      "resolved",

    partially_resolved:
      "partially_resolved",

    not_resolved:
      "not_resolved"

  },


  partially_resolved: {

    resolved:
      "partially_resolved",

    partially_resolved:
      "partially_resolved",

    not_resolved:
      "partially_resolved"

  },


  not_resolved: {

    resolved:
      "partially_resolved",

    partially_resolved:
      "not_resolved",

    not_resolved:
      "not_resolved"

  }

};


// --------------------------------------------------
// Final appeal outcome
//
// When AI is unavailable the deterministic outcome
// stands on its own, exactly as before.
// --------------------------------------------------

export function deriveFinalAppealOutcome(
  rulesReview,
  aiReview
) {

  const rulesOutcome =
    OUTCOME_MATRIX[
      rulesReview?.outcome
    ]
      ? rulesReview.outcome
      : "not_resolved";


  if (
    !aiReview?.available
  ) {

    return rulesOutcome;

  }


  const row =
    OUTCOME_MATRIX[
      rulesOutcome
    ];


  return row[
    aiReview.outcome
  ] ||
  "not_resolved";

}


// --------------------------------------------------
// Count findings neither reviewer could clear
//
// Useful for ordering a human queue: an appeal with
// one open finding is not the same amount of work as
// an appeal with six.
// --------------------------------------------------

function countOpenFindings(
  rulesReview,
  aiReview
) {

  const results =
    [

      ...(
        Array.isArray(
          rulesReview?.results
        )
          ? rulesReview.results
          : []
      ),

      ...(
        aiReview?.available &&
        Array.isArray(
          aiReview.results
        )
          ? aiReview.results
          : []
      )

    ];


  return results.filter(
    (result) =>
      result.outcome !==
      "resolved"
  ).length;

}


// ==================================================
// ORCHESTRATE ONE APPEAL
//
// originalClaim must be the STORED claim, because the
// appeal reviewers judge the appeal against the
// findings that were recorded at claim time.
// ==================================================

export async function orchestrateAppeal(
  originalClaim,
  appeal,
  {
    logger =
      console
  } = {}
) {

  const decision =
    await runReviewPipeline({

      stage:
        "appeal",

      subject:
        appeal.claimNumber ||
        originalClaim?.claimNumber ||
        "(unnumbered appeal)",

      logger,


      // --------------------------------------------
      // Deterministic re-check
      // --------------------------------------------

      runRules:
        () =>
          analyzeAppeal(
            originalClaim,
            appeal
          ),


      // --------------------------------------------
      // AI evidence comparison
      // --------------------------------------------

      runAi:
        (signal) =>
          reviewAppealWithAI(
            originalClaim,
            appeal,
            { signal }
          ),


      aiUnavailable:
        (reason) => ({

          available:
            false,

          outcome:
            "unavailable",

          summary:
            "AI appeal evidence review unavailable.",

          results:
            [],

          error:
            reason

        }),


      // --------------------------------------------
      // Reconcile
      // --------------------------------------------

      reconcile:
        ({
          rules,
          ai
        }) => {

          const finalOutcome =
            deriveFinalAppealOutcome(
              rules,
              ai
            );


          return {

            headline:
              `outcome=${finalOutcome}`,

            finalOutcome,

            rulesOutcome:
              rules?.outcome ||
              "not_resolved",

            aiOutcome:

              ai?.available
                ? ai.outcome
                : "unavailable",

            openFindings:
              countOpenFindings(
                rules,
                ai
              )

          };

        },


      // --------------------------------------------
      // Route
      //
      // workflowStatus is what the dashboard reads.
      // --------------------------------------------

      route:
        ({
          verdict
        }) => {

          if (
            verdict.finalOutcome ===
            "resolved"
          ) {

            return {

              nextStep:
                "close_appeal",

              workflowStatus:
                "completed",

              needsHumanReview:
                false

            };

          }


          if (
            verdict.finalOutcome ===
            "partially_resolved"
          ) {

            return {

              nextStep:
                "human_review_remaining",

              workflowStatus:
                "pending",

              needsHumanReview:
                true

            };

          }


          return {

            nextStep:
              "human_review_unresolved",

            workflowStatus:
              "pending",

            needsHumanReview:
              true

          };

        }

    });


  // ------------------------------------------------
  // Names db.createAppeal and the frontend expect.
  // ------------------------------------------------

  decision.rulesReview =
    decision.rules;

  decision.aiReview =
    decision.ai;

  decision.finalOutcome =
    decision.verdict.finalOutcome;

  decision.workflowStatus =
    decision.routing.workflowStatus;


  return decision;

}
