// ==================================================
// ORCHESTRATION EXAMPLE RUNNER
//
//   npm run example
//
// Walks every scenario in fixtures.js through the
// full two-stage workflow:
//
//   claim  -> orchestrateClaim  -> risk + routing
//   appeal -> orchestrateAppeal -> outcome + routing
//
// Nothing is written to the database and no HTTP
// server is started, so this is safe to run at any
// time.
//
// WITHOUT an OPENAI_API_KEY the AI reviewers report
// themselves unavailable and the run is fully
// deterministic, so every expectation is checked.
//
// WITH a key the run is hybrid. The deterministic
// expectations are still checked, because that layer
// cannot be moved by the model. Routing is only
// reported, because AI is allowed to escalate.
// ==================================================

import "dotenv/config";

import {
  orchestrateClaim
} from "../orchestration/claim-orchestrator.js";

import {
  orchestrateAppeal
} from "../orchestration/appeal-orchestrator.js";

import {
  SCENARIOS
} from "./fixtures.js";


// --------------------------------------------------
// The orchestrators log a line per stage. The example
// prints its own report, so give them a quiet logger.
// --------------------------------------------------

const QUIET = {

  log:
    () => {},

  error:
    () => {}

};


const AI_ENABLED =
  Boolean(
    process.env.OPENAI_API_KEY
  );


const failures =
  [];


function check(
  label,
  actual,
  expected
) {

  const ok =
    actual ===
    expected;


  if (
    !ok
  ) {

    failures.push(
      `${label}: expected ${expected}, got ${actual}`
    );

  }


  return ok
    ? "ok"
    : `MISMATCH (expected ${expected})`;

}


function money(
  value
) {

  return `$${
    Number(
      value ||
      0
    ).toFixed(2)
  }`;

}


function describeFlag(
  flag
) {

  const detectedBy =

    Array.isArray(
      flag.detectedBy
    )
      ? flag.detectedBy.join("+")
      : "rules";


  return `${
    flag.type
  } [${
    flag.severity
  }] ${
    flag.lineCode ||
    "claim-level"
  } (${detectedBy})`;

}


// ==================================================
// RUN
// ==================================================

console.log("");

console.log(
  "=".repeat(64)
);

console.log(
  `CLAIM INTEGRITY ORCHESTRATION - ${
    AI_ENABLED
      ? "HYBRID (rules + AI)"
      : "RULES ONLY (no OPENAI_API_KEY)"
  }`
);

console.log(
  "=".repeat(64)
);


for (
  const scenario
  of SCENARIOS
) {

  console.log("");

  console.log(
    `\n### ${scenario.claim.claimNumber} - ${scenario.name}`
  );


  // ------------------------------------------------
  // STAGE 1
  // ------------------------------------------------

  const claimDecision =
    await orchestrateClaim(
      scenario.claim,
      {
        logger:
          QUIET
      }
    );


  const analysis =
    claimDecision.analysis;


  console.log(
    `  billed ${
      money(analysis.totalBilled)
    }  |  under review ${
      money(analysis.reviewAmount)
    }  |  rule score ${
      analysis.riskScore
    }`
  );


  console.log(
    `  rules=${
      analysis.rulesRiskLevel
    }  ai=${
      analysis.aiRiskLevel
    }  final=${
      analysis.riskLevel
    }  ->  ${
      claimDecision.routing.nextStep
    }`
  );


  if (
    analysis.flags.length ===
    0
  ) {

    console.log(
      "  findings: none"
    );

  } else {

    for (
      const flag
      of analysis.flags
    ) {

      console.log(
        `  - ${describeFlag(flag)}`
      );

    }

  }


  console.log(
    `  rules risk .......... ${
      check(
        `${scenario.claim.claimNumber} rulesRiskLevel`,
        analysis.rulesRiskLevel,
        scenario.expects.rulesRiskLevel
      )
    }`
  );


  const ruleFlagTypes =
    analysis.flags
      .filter(
        (flag) =>
          flag.detectedBy.includes(
            "rules"
          )
      )
      .map(
        (flag) =>
          flag.type
      )
      .sort()
      .join(",");


  console.log(
    `  rules findings ...... ${
      check(
        `${scenario.claim.claimNumber} rule finding types`,
        ruleFlagTypes,
        [...scenario.expects.flagTypes].sort().join(",")
      )
    }`
  );


  if (
    AI_ENABLED
  ) {

    console.log(
      `  routing ............. ${
        claimDecision.routing.nextStep
      } (not checked in hybrid mode)`
    );

  } else {

    console.log(
      `  routing ............. ${
        check(
          `${scenario.claim.claimNumber} nextStep`,
          claimDecision.routing.nextStep,
          scenario.expects.nextStep
        )
      }`
    );

  }


  // ------------------------------------------------
  // STAGE 2
  //
  // The appeal reviewers judge an appeal against the
  // STORED claim, so hand them the claim plus the
  // findings stage one produced. This is the same
  // shape db.getClaim returns.
  // ------------------------------------------------

  const storedClaim = {

    ...scenario.claim,

    ...analysis

  };


  for (
    const appealCase
    of scenario.appeals
  ) {

    const appealDecision =
      await orchestrateAppeal(
        storedClaim,
        appealCase.appeal,
        {
          logger:
            QUIET
        }
      );


    console.log(
      `\n  APPEAL: ${appealCase.name}`
    );


    console.log(
      `    rules=${
        appealDecision.verdict.rulesOutcome
      }  ai=${
        appealDecision.verdict.aiOutcome
      }  final=${
        appealDecision.finalOutcome
      }  ->  ${
        appealDecision.routing.nextStep
      } (${
        appealDecision.workflowStatus
      })`
    );


    for (
      const result
      of appealDecision.rulesReview.results
    ) {

      console.log(
        `    - ${
          result.originalFindingType
        } ${
          result.lineCode ||
          "claim-level"
        }: ${
          result.outcome
        }`
      );

    }


    console.log(
      `    rules outcome ..... ${
        check(
          `${appealCase.appeal.claimNumber} / ${appealCase.name} rulesOutcome`,
          appealDecision.verdict.rulesOutcome,
          appealCase.expects.rulesOutcome
        )
      }`
    );


    if (
      AI_ENABLED
    ) {

      console.log(
        `    routing ........... ${
          appealDecision.routing.nextStep
        } (not checked in hybrid mode)`
      );

    } else {

      console.log(
        `    routing ........... ${
          check(
            `${appealCase.appeal.claimNumber} / ${appealCase.name} nextStep`,
            appealDecision.routing.nextStep,
            appealCase.expects.nextStep
          )
        }`
      );

    }

  }

}


// ==================================================
// SUMMARY
// ==================================================

console.log("");

console.log(
  "=".repeat(64)
);


if (
  failures.length ===
  0
) {

  console.log(
    "All expectations held."
  );


  console.log(
    "=".repeat(64)
  );


  console.log("");

} else {

  console.log(
    `${failures.length} expectation(s) failed:`
  );


  for (
    const failure
    of failures
  ) {

    console.log(
      `  - ${failure}`
    );

  }


  console.log(
    "=".repeat(64)
  );


  console.log("");


  process.exitCode =
    1;

}
