// ==================================================
// PROVIDER CALL EXAMPLE
//
//   npm run example:call
//
// Stage three of the workflow, end to end, with no
// phone call and no database.
//
// vapi.js owns the real outbound call, so the queue
// is injected. Here it is replaced with a fake that
// plays back a call lifecycle:
//
//   started -> ringing -> in-progress -> ended
//
// and a fake store that records what would have been
// written to the database.
//
// What this shows:
//
//   1. a low-risk claim places no call at all
//   2. a flagged claim places one, and the brief is
//      ordered worst finding first
//   3. the transcript is normalized on the way in
//   4. a failed call is recorded, not lost
// ==================================================

import "dotenv/config";

import {
  orchestrateClaim
} from "../orchestration/claim-orchestrator.js";

import {
  orchestrateProviderCall
} from "../orchestration/call-orchestrator.js";

import {
  SCENARIOS
} from "./fixtures.js";


const QUIET = {

  log:
    () => {},

  error:
    () => {}

};


const failures =
  [];


function expect(
  label,
  actual,
  expected
) {

  if (
    actual !==
    expected
  ) {

    failures.push(
      `${label}: expected ${expected}, got ${actual}`
    );

  }

}


// --------------------------------------------------
// Fake database
// --------------------------------------------------

function makeStore() {

  const created =
    [];

  const statuses =
    [];

  const completed =
    [];


  return {

    created,

    statuses,

    completed,


    createVapiCall:
      (
        claimNumber,
        callId,
        status
      ) =>
        created.push({
          claimNumber,
          callId,
          status
        }),


    updateVapiCallStatus:
      (
        callId,
        status
      ) =>
        statuses.push({
          callId,
          status
        }),


    completeVapiCall:
      (
        callId,
        payload
      ) =>
        completed.push({
          callId,
          ...payload
        })

  };

}


// --------------------------------------------------
// Fake Vapi queue
//
// Same contract as queueVapiCall: returns immediately
// and drives the handlers in the background.
// --------------------------------------------------

function makeFakeQueue(
  {
    callId,
    transcript,
    failWith =
      null
  }
) {

  let lifecycle =
    Promise.resolve();


  const queue =
    (
      claim,
      findings,
      handlers
    ) => {

      lifecycle =
        (async () => {

          if (
            failWith
          ) {

            await handlers.onStarted({

              callId,

              status:
                "created"

            });


            await handlers.onFailed(
              new Error(
                failWith
              ),
              callId
            );


            return;

          }


          await handlers.onStarted({

            callId,

            status:
              "created"

          });


          await handlers.onUpdate({

            id:
              callId,

            status:
              "ringing"

          });


          await handlers.onUpdate({

            id:
              callId,

            status:
              "in-progress"

          });


          await handlers.onCompleted({

            id:
              callId,

            status:
              "ended",

            endedReason:
              "customer-ended-call",

            startedAt:
              "2026-03-04T14:02:10.000Z",

            endedAt:
              "2026-03-04T14:03:48.000Z",

            artifact: {

              transcript,

              messages: [
                {
                  role: "assistant",
                  message: "(recorded)"
                }
              ]

            }

          });

        })();


      return {

        queued:
          true,

        position:
          1

      };

    };


  return {

    queue,

    settled:
      () =>
        lifecycle

  };

}


// --------------------------------------------------
// A transcript in the array shape Vapi returns.
// --------------------------------------------------

const TRANSCRIPT = [

  {
    role: "assistant",
    message: "Hello, this is an automated review call about claim CLM-1002. Our review found procedure 99214 billed twice on the same service date. Can you confirm whether that was one encounter or two?"
  },

  {
    role: "user",
    message: "Let me look. That was one encounter. The second line was a submission error on our end."
  },

  {
    role: "assistant",
    message: "Thank you. I have noted that for the reviewer. Someone will follow up with you."
  }

];


function scenario(
  claimNumber
) {

  const found =
    SCENARIOS.find(
      (item) =>
        item.claim.claimNumber ===
        claimNumber
    );


  if (
    !found
  ) {

    throw new Error(
      `Fixture ${claimNumber} is missing.`
    );

  }


  return found.claim;

}


// ==================================================
// RUN
// ==================================================

console.log("");

console.log(
  "=".repeat(64)
);

console.log(
  "PROVIDER CLARIFICATION CALL - fake queue, fake store"
);

console.log(
  "=".repeat(64)
);


// --------------------------------------------------
// 1. A clean claim places no call
// --------------------------------------------------

console.log(
  "\n### CLM-1001 - clean claim"
);


const cleanDecision =
  await orchestrateClaim(
    scenario("CLM-1001"),
    {
      logger:
        QUIET
    }
  );


const cleanStore =
  makeStore();


const cleanFake =
  makeFakeQueue({
    callId:
      "call_should_not_happen",
    transcript:
      TRANSCRIPT
  });


const cleanCall =
  orchestrateProviderCall(
    scenario("CLM-1001"),
    cleanDecision,
    {

      store:
        cleanStore,

      queue:
        cleanFake.queue,

      logger:
        QUIET

    }
  );


console.log(
  `  routing ......... ${cleanDecision.routing.nextStep}`
);

console.log(
  `  call placed ..... ${cleanCall.queued}`
);

console.log(
  `  reason .......... ${cleanCall.reason}`
);


expect(
  "clean claim places no call",
  cleanCall.queued,
  false
);

expect(
  "clean claim writes no call record",
  cleanStore.created.length,
  0
);


// --------------------------------------------------
// 2. A flagged claim places one
// --------------------------------------------------

console.log(
  "\n### CLM-1007 - several findings at once"
);


const flaggedClaim =
  scenario("CLM-1007");


const flaggedDecision =
  await orchestrateClaim(
    flaggedClaim,
    {
      logger:
        QUIET
    }
  );


const store =
  makeStore();


const fake =
  makeFakeQueue({

    callId:
      "call_demo_1",

    transcript:
      TRANSCRIPT

  });


const call =
  orchestrateProviderCall(
    flaggedClaim,
    flaggedDecision,
    {

      store,

      queue:
        fake.queue,

      logger:
        QUIET

    }
  );


console.log(
  `  routing ......... ${flaggedDecision.routing.nextStep}`
);

console.log(
  `  call placed ..... ${call.queued} (queue position ${call.position})`
);


console.log(
  "  brief, worst finding first:"
);

for (
  const line
  of call.brief.lines
) {

  console.log(
    `    - ${line}`
  );

}


// The call runs in the background, so wait for the
// fake lifecycle to play out before inspecting.

await fake.settled();


console.log(
  "  persisted:"
);

console.log(
  `    created ....... ${
    store.created[0]?.callId
  } (${
    store.created[0]?.status
  }) for ${
    store.created[0]?.claimNumber
  }`
);

console.log(
  `    status trail .. ${
    store.statuses
      .map(
        (entry) =>
          entry.status
      )
      .join(" -> ")
  }`
);

console.log(
  `    ended ......... ${
    store.completed[0]?.status
  } (${
    store.completed[0]?.endedReason
  })`
);


console.log(
  "  transcript, normalized to text:"
);

for (
  const line
  of String(
    store.completed[0]?.transcript ||
    ""
  ).split("\n")
) {

  console.log(
    `    | ${line}`
  );

}


expect(
  "flagged claim places a call",
  call.queued,
  true
);

expect(
  "brief leads with the high-severity finding",
  call.brief.findings[0]?.severity,
  "high"
);

expect(
  "brief carries every finding",
  call.brief.findings.length,
  flaggedDecision.analysis.flags.length
);

expect(
  "call record is created",
  store.created[0]?.callId,
  "call_demo_1"
);

expect(
  "status updates are recorded",
  store.statuses
    .map(
      (entry) =>
        entry.status
    )
    .join(","),
  "ringing,in-progress"
);

expect(
  "transcript is normalized to a string",
  typeof store.completed[0]?.transcript,
  "string"
);

expect(
  "transcript keeps every turn",
  String(
    store.completed[0]?.transcript
  ).split("\n").length,
  TRANSCRIPT.length
);

expect(
  "transcript labels the provider side",
  String(
    store.completed[0]?.transcript
  ).includes(
    "Customer: Let me look."
  ),
  true
);


// --------------------------------------------------
// 3. A failed call is recorded, not lost
// --------------------------------------------------

console.log(
  "\n### CLM-1002 - the call fails"
);


const failingClaim =
  scenario("CLM-1002");


const failingDecision =
  await orchestrateClaim(
    failingClaim,
    {
      logger:
        QUIET
    }
  );


const failStore =
  makeStore();


const failFake =
  makeFakeQueue({

    callId:
      "call_demo_2",

    transcript:
      TRANSCRIPT,

    failWith:
      "No answer from the billing contact."

  });


orchestrateProviderCall(
  failingClaim,
  failingDecision,
  {

    store:
      failStore,

    queue:
      failFake.queue,

    logger:
      QUIET

  }
);


await failFake.settled();


console.log(
  `  created ......... ${failStore.created[0]?.callId}`
);

console.log(
  `  final status .... ${
    failStore.statuses
      .at(-1)
      ?.status
  }`
);

console.log(
  `  completed ....... ${failStore.completed.length} record(s)`
);


expect(
  "a failed call is still recorded",
  failStore.created[0]?.callId,
  "call_demo_2"
);

expect(
  "a failed call is marked failed",
  failStore.statuses.at(-1)?.status,
  "failed"
);

expect(
  "a failed call is not marked complete",
  failStore.completed.length,
  0
);


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


  process.exitCode =
    1;

}


console.log(
  "=".repeat(64)
);

console.log("");
