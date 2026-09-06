// ==================================================
// DEMO FILE RUNNER
//
//   npm run example:demo
//
// Runs the SHIPPED demo assets through all three
// stages and checks each one against the outcome its
// filename promises:
//
//   demo/claim_01_clean.csv            -> low
//   demo/claim_03_review_price.csv     -> review
//   demo/claim_06_high_duplicate.csv   -> high
//
//   demo_appeal/..._WORKS_....txt      -> resolved
//   demo_appeal/..._PARTIAL_....txt    -> partially_resolved
//   demo_appeal/..._FAIL_....txt       -> not_resolved
//
// This is what protects the live demo: if an analyzer
// threshold or a demo file is edited so a file no
// longer does what its name says, this fails.
//
// No database, no server, no phone call. Without an
// ANTHROPIC_API_KEY every expectation is checked; with a
// key the deterministic layer is still checked and
// the merged result is reported.
// ==================================================

import "dotenv/config";

import {
  readFileSync,
  readdirSync
} from "node:fs";

import {
  join
} from "node:path";

import {
  orchestrateClaim
} from "../orchestration/claim-orchestrator.js";

import {
  orchestrateProviderCall
} from "../orchestration/call-orchestrator.js";

import {
  orchestrateAppeal
} from "../orchestration/appeal-orchestrator.js";

import {
  claimFromCsv,
  appealFromTxt
} from "./demo-file-parsers.js";


const QUIET = {

  log:
    () => {},

  error:
    () => {}

};


const DRY_RUN_QUEUE =
  () => ({

    queued:
      true,

    position:
      1

  });


const AI_ENABLED =
  Boolean(
    process.env.ANTHROPIC_API_KEY
  );


const failures =
  [];


function check(
  label,
  actual,
  expected
) {

  if (
    actual ===
    expected
  ) {

    return "ok";

  }


  failures.push(
    `${label}: expected ${expected}, got ${actual}`
  );


  return `MISMATCH (expected ${expected})`;

}


// --------------------------------------------------
// What each filename promises
// --------------------------------------------------

function riskFromFilename(
  name
) {

  if (
    name.includes(
      "_high_"
    )
  ) {

    return "high";

  }


  if (
    name.includes(
      "_clean"
    )
  ) {

    return "low";

  }


  return "review";

}


function outcomeFromFilename(
  name
) {

  if (
    name.includes(
      "_WORKS_"
    )
  ) {

    return "resolved";

  }


  if (
    name.includes(
      "_PARTIAL_"
    )
  ) {

    return "partially_resolved";

  }


  if (
    name.includes(
      "_FAIL_"
    )
  ) {

    return "not_resolved";

  }


  return null;

}


function listFiles(
  directory,
  extension
) {

  return readdirSync(
    directory
  )
    .filter(
      (name) =>
        name.endsWith(
          extension
        )
    )
    .sort();

}


// ==================================================
// STAGE 1 + 2 - every demo claim
// ==================================================

console.log("");

console.log(
  "=".repeat(78)
);

console.log(
  `DEMO FILES - ${
    AI_ENABLED
      ? "HYBRID (rules + AI)"
      : "RULES ONLY (no ANTHROPIC_API_KEY)"
  }`
);

console.log(
  "=".repeat(78)
);


console.log(
  `\n${
    "file".padEnd(38)
  }${
    "claim".padEnd(12)
  }${
    "risk".padEnd(9)
  }${
    "call".padEnd(7)
  }check`
);


const storedClaims =
  new Map();


for (
  const name
  of listFiles(
    "demo",
    ".csv"
  )
) {

  const claim =
    claimFromCsv(
      readFileSync(
        join(
          "demo",
          name
        ),
        "utf8"
      )
    );


  const decision =
    await orchestrateClaim(
      claim,
      {
        logger:
          QUIET
      }
    );


  const call =
    orchestrateProviderCall(
      claim,
      decision,
      {

        store:
          null,

        queue:
          DRY_RUN_QUEUE,

        logger:
          QUIET

      }
    );


  // The appeal stage needs the claim as it would have
  // been stored, findings included.

  storedClaims.set(
    claim.claimNumber,
    {
      ...claim,
      ...decision.analysis
    }
  );


  const expected =
    riskFromFilename(
      name
    );


  const verdict =

    AI_ENABLED

      ? check(
          `${name} rulesRiskLevel`,
          decision.analysis.rulesRiskLevel,
          expected
        )

      : check(
          `${name} riskLevel`,
          decision.analysis.riskLevel,
          expected
        );


  console.log(
    `${
      name.padEnd(38)
    }${
      claim.claimNumber.padEnd(12)
    }${
      decision.analysis.riskLevel.padEnd(9)
    }${
      (
        call.queued
          ? `${call.brief.findings.length}`
          : "-"
      ).padEnd(7)
    }${verdict}`
  );


  if (
    call.queued !==
    decision.routing.needsHumanReview
  ) {

    failures.push(
      `${name}: a call was placed without routing asking for a human`
    );

  }

}


// ==================================================
// STAGE 3 - every demo appeal
// ==================================================

console.log(
  `\n${
    "file".padEnd(54)
  }${
    "outcome".padEnd(20)
  }check`
);


for (
  const name
  of listFiles(
    "demo_appeal",
    ".txt"
  )
) {

  const expected =
    outcomeFromFilename(
      name
    );


  if (
    !expected
  ) {

    console.log(
      `${
        name.padEnd(54)
      }${
        "(unlabelled)".padEnd(20)
      }skipped`
    );


    continue;

  }


  const appeal =
    appealFromTxt(
      readFileSync(
        join(
          "demo_appeal",
          name
        ),
        "utf8"
      )
    );


  const originalClaim =
    storedClaims.get(
      appeal.claimNumber
    );


  if (
    !originalClaim
  ) {

    failures.push(
      `${name}: no demo claim matches ${appeal.claimNumber}`
    );


    console.log(
      `${
        name.padEnd(54)
      }${
        "-".padEnd(20)
      }NO MATCHING CLAIM`
    );


    continue;

  }


  const decision =
    await orchestrateAppeal(
      originalClaim,
      appeal,
      {
        logger:
          QUIET
      }
    );


  const verdict =

    AI_ENABLED

      ? check(
          `${name} rulesOutcome`,
          decision.verdict.rulesOutcome,
          expected
        )

      : check(
          `${name} finalOutcome`,
          decision.finalOutcome,
          expected
        );


  console.log(
    `${
      name.padEnd(54)
    }${
      decision.finalOutcome.padEnd(20)
    }${verdict}`
  );

}


// ==================================================
// SUMMARY
// ==================================================

console.log("");

console.log(
  "=".repeat(78)
);


if (
  failures.length ===
  0
) {

  console.log(
    "Every demo file did what its filename promises."
  );

} else {

  console.log(
    `${failures.length} demo file(s) no longer match their filename:`
  );


  for (
    const failure
    of failures
  ) {

    console.log(
      `  - ${failure}`
    );

  }


  process.exitCode =
    1;

}


console.log(
  "=".repeat(78)
);

console.log("");
