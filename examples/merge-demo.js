// ==================================================
// MERGE DEMO
//
//   npm run example:merge
//
// The claim stage merges deterministic findings with
// AI findings. That step needs a live model, so this
// example feeds a HAND-WRITTEN AI review into the
// merge instead, to show the pairing rules without a
// network call.
//
// The case that matters is one procedure code that
// carries TWO deterministic findings. The AI has an
// opinion about each. Both opinions must survive and
// land on the right finding.
// ==================================================

import {
  mergeAiFindings
} from "../orchestration/claim-orchestrator.js";


// --------------------------------------------------
// Deterministic findings, as analyzer.js would emit
// them: one code, two separate concerns.
// --------------------------------------------------

function buildAnalysis() {

  return {

    flags: [

      {
        type: "duplicate",
        severity: "high",
        lineCode: "99214",
        message: "Procedure 99214 appears more than once on the same service date.",
        evidence: "2 entries for procedure 99214 were billed on 2026-03-04.",
        detectedBy: ["rules"]
      },

      {
        type: "price_outlier",
        severity: "medium",
        lineCode: "99214",
        message: "Procedure 99214 is billed well above the reference amount.",
        evidence: "Billed amount is $600.00 compared with a reference amount of $165.00.",
        detectedBy: ["rules"]
      }

    ]

  };

}


// --------------------------------------------------
// A hand-written AI review of the same claim.
//
//   two opinions about 99214, one per concern
//   one claim-level opinion tied to no code
// --------------------------------------------------

const AI_REVIEW = {

  available:
    true,

  riskScore:
    72,

  riskLevel:
    "high",

  summary:
    "Hand-written example review.",

  findings: [

    {
      lineCode: "99214",
      severity: "medium",
      reason: "duplicate_service",
      message: "The note describes a single encounter.",
      evidence: "Clinical note refers to one visit on 2026-03-04."
    },

    {
      lineCode: "99214",
      severity: "high",
      reason: "unusual_billing",
      message: "The billed amount is not supported by the documentation.",
      evidence: "Note describes a routine follow-up."
    },

    {
      lineCode: "",
      severity: "medium",
      reason: "missing_support",
      message: "No diagnosis context supports the billed services.",
      evidence: "The claim supplies no diagnosis codes."
    }

  ]

};


// ==================================================
// RUN
// ==================================================

const analysis =
  buildAnalysis();


console.log("");

console.log(
  "BEFORE MERGE"
);

for (
  const flag
  of analysis.flags
) {

  console.log(
    `  ${flag.type} [${flag.severity}] ${flag.lineCode} (${flag.detectedBy.join("+")})`
  );

}


mergeAiFindings(
  analysis,
  AI_REVIEW
);


console.log("");

console.log(
  "AFTER MERGE"
);

for (
  const flag
  of analysis.flags
) {

  console.log(
    `  ${flag.type} [${flag.severity}] ${
      flag.lineCode ||
      "claim-level"
    } (${flag.detectedBy.join("+")})`
  );


  if (
    flag.aiReview
  ) {

    console.log(
      `      ai: ${flag.aiReview.reason} - ${flag.aiReview.message}`
    );

  }

}


const problems =
  [];


// --------------------------------------------------
// What to look for
// --------------------------------------------------

console.log("");

console.log(
  "Expected:"
);

console.log(
  "  - duplicate keeps its own AI opinion (duplicate_service)"
);

console.log(
  "  - price_outlier keeps a DIFFERENT AI opinion (unusual_billing)"
);

console.log(
  "  - price_outlier escalates medium -> high, duplicate stays high"
);

console.log(
  "  - the claim-level AI finding is added as its own ai-only flag"
);

console.log("");


// --------------------------------------------------
// Assertions
// --------------------------------------------------

const duplicateFlag =
  analysis.flags.find(
    (flag) =>
      flag.type ===
      "duplicate"
  );


const priceFlag =
  analysis.flags.find(
    (flag) =>
      flag.type ===
      "price_outlier"
  );


if (
  duplicateFlag?.aiReview?.reason !==
  "duplicate_service"
) {

  problems.push(
    "duplicate flag did not receive the duplicate_service opinion"
  );

}


if (
  priceFlag?.aiReview?.reason !==
  "unusual_billing"
) {

  problems.push(
    "price_outlier flag did not receive the unusual_billing opinion"
  );

}


if (
  priceFlag?.severity !==
  "high"
) {

  problems.push(
    "price_outlier flag was not escalated to high"
  );

}


if (
  analysis.flags.length !==
  3
) {

  problems.push(
    `expected 3 flags after merge, got ${analysis.flags.length}`
  );

}


// ==================================================
// CASE 2
//
// The AI returns MORE opinions about a code than
// there are deterministic findings for it.
//
// The extra opinions become their own ai-only
// findings. The one thing that must NOT happen is an
// extra opinion landing on an ai-only finding added
// moments earlier in the same merge, because that
// would overwrite the opinion already there.
// ==================================================

const crowded = {

  flags: [

    {
      type: "duplicate",
      severity: "high",
      lineCode: "99214",
      message: "Procedure 99214 appears more than once on the same service date.",
      evidence: "2 entries for procedure 99214 were billed on 2026-03-04.",
      detectedBy: ["rules"]
    }

  ]

};


mergeAiFindings(
  crowded,
  {

    available:
      true,

    findings: [

      {
        lineCode: "99214",
        severity: "medium",
        reason: "duplicate_service",
        message: "First opinion.",
        evidence: ""
      },

      {
        lineCode: "99214",
        severity: "medium",
        reason: "unusual_billing",
        message: "Second opinion.",
        evidence: ""
      },

      {
        lineCode: "99214",
        severity: "medium",
        reason: "missing_support",
        message: "Third opinion.",
        evidence: ""
      }

    ]

  }
);


console.log(
  "CASE 2: three AI opinions, one deterministic finding"
);


for (
  const flag
  of crowded.flags
) {

  console.log(
    `  ${flag.type} (${flag.detectedBy.join("+")}) ai: ${
      flag.aiReview?.message ||
      "none"
    }`
  );

}


const retained =
  new Set(
    crowded.flags
      .map(
        (flag) =>
          flag.aiReview?.message
      )
      .filter(Boolean)
  );


console.log(
  `  distinct opinions retained: ${retained.size} of 3`
);

console.log("");


if (
  retained.size !==
  3
) {

  problems.push(
    `an AI opinion was overwritten: ${retained.size} of 3 retained`
  );

}


if (
  crowded.flags.length !==
  3
) {

  problems.push(
    `expected 3 flags in the crowded case, got ${crowded.flags.length}`
  );

}


if (
  problems.length ===
  0
) {

  console.log(
    "All expectations held."
  );

} else {

  for (
    const problem
    of problems
  ) {

    console.log(
      `FAILED: ${problem}`
    );

  }


  process.exitCode =
    1;

}


console.log("");
