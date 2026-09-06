// ==================================================
// SHARED REVIEW PIPELINE
//
// Both the claim stage and the appeal stage have the
// exact same shape:
//
//   1. a DETERMINISTIC reviewer  (fast, objective)
//   2. an AI reviewer            (slow, evidentiary)
//   3. a RECONCILE step          (combine the two)
//   4. a ROUTE step              (what happens next)
//
// The only thing that differs is WHICH reviewers run
// and HOW their two opinions are reconciled.
//
// So both stages are expressed as configuration of
// this one pipeline instead of being written twice
// inline inside server.js.
//
// IMPORTANT BOUNDARY (unchanged from the reviewers):
//
// Nothing here determines fraud, makes a payment
// decision, or replaces human review. It only decides
// which work item a human should look at next.
// ==================================================


// --------------------------------------------------
// AI call budget
//
// The AI reviewers already fail soft, but a hung
// request would still stall the whole HTTP handler.
// The pipeline caps it so the deterministic result is
// always returned in bounded time.
// --------------------------------------------------

export const AI_TIMEOUT_MS =

  Number(
    process.env.AI_TIMEOUT_MS ||
    30000
  );


// --------------------------------------------------
// Race a promise against a timeout.
//
// On timeout we resolve with a marker rather than
// rejecting, so the caller can degrade gracefully
// instead of entering an error path.
// --------------------------------------------------

const TIMED_OUT =
  Symbol(
    "ai_timed_out"
  );


function withTimeout(
  run,
  milliseconds
) {

  let timer;


  const controller =
    new AbortController();


  const promise =
    Promise.resolve()
      .then(
        () =>
          run(
            controller.signal
          )
      );


  const timeout =

    new Promise(
      (resolve) => {

        timer =
          setTimeout(
            () => {

              resolve(
                TIMED_OUT
              );

              controller.abort();

            },
            milliseconds
          );

      }
    );


  return Promise
    .race([
      promise,
      timeout
    ])
    .finally(
      () =>
        clearTimeout(
          timer
        )
    );

}


// --------------------------------------------------
// Monotonic-ish timer for the trace
// --------------------------------------------------

function now() {

  return Date.now();

}


// ==================================================
// RUN ONE REVIEW PIPELINE
//
// Options:
//
//   stage           "claim" | "appeal"
//   subject         label used in logs and the trace
//   runRules        () => deterministic result
//   runAi           () => Promise<ai result>
//   aiUnavailable   (reason) => fallback ai result
//   reconcile       ({ rules, ai }) => verdict
//   route           ({ rules, ai, verdict }) => routing
//   logger          optional console-like object
//
// Returns a DECISION RECORD shared by both stages.
// ==================================================

export async function runReviewPipeline(
  {

    stage,

    subject,

    runRules,

    runAi,

    aiUnavailable,

    reconcile,

    route,

    logger =
      console

  }
) {

  const startedAt =
    now();


  const trace =
    [];


  function record(
    step,
    status,
    stepStartedAt,
    detail
  ) {

    trace.push({

      step,

      status,

      ms:
        now() -
        stepStartedAt,

      detail:
        detail ||
        ""

    });

  }


  // ------------------------------------------------
  // STEP 1: deterministic reviewer
  //
  // This is the floor of the whole system. If it
  // throws, there is no usable decision at all, so
  // the error is allowed to propagate to the caller.
  // ------------------------------------------------

  const rulesStartedAt =
    now();


  const rules =
    runRules();


  record(
    "rules",
    "ok",
    rulesStartedAt,
    describeRules(
      stage,
      rules
    )
  );


  // ------------------------------------------------
  // STEP 2: AI reviewer
  //
  // Three ways this can fail, all of which must end
  // with a usable rules-only decision:
  //
  //   - no API key configured
  //   - the request threw
  //   - the request exceeded AI_TIMEOUT_MS
  // ------------------------------------------------

  const aiStartedAt =
    now();


  let ai;


  try {

    const settled =
      await withTimeout(
        runAi,
        AI_TIMEOUT_MS
      );


    if (
      settled ===
      TIMED_OUT
    ) {

      ai =
        aiUnavailable(
          `AI review exceeded ${AI_TIMEOUT_MS}ms.`
        );


      record(
        "ai",
        "timeout",
        aiStartedAt,
        `Timed out after ${AI_TIMEOUT_MS}ms.`
      );

    } else {

      ai =
        settled;


      record(
        "ai",

        ai?.available
          ? "ok"
          : "unavailable",

        aiStartedAt,

        describeAi(
          stage,
          ai
        )
      );

    }

  } catch (
    error
  ) {

    const message =
      error?.message ||
      String(error);


    logger.error(
      `[${stage}] AI review error for ${subject}:`,
      message
    );


    ai =
      aiUnavailable(
        message
      );


    record(
      "ai",
      "error",
      aiStartedAt,
      message
    );

  }


  // ------------------------------------------------
  // STEP 3: reconcile
  // ------------------------------------------------

  const reconcileStartedAt =
    now();


  const verdict =
    reconcile({
      rules,
      ai
    });


  record(
    "reconcile",
    "ok",
    reconcileStartedAt,
    verdict.headline ||
    ""
  );


  // ------------------------------------------------
  // STEP 4: route
  // ------------------------------------------------

  const routeStartedAt =
    now();


  const routing =
    route({
      rules,
      ai,
      verdict
    });


  record(
    "route",
    "ok",
    routeStartedAt,
    routing.nextStep ||
    ""
  );


  const decision = {

    stage,

    subject,

    mode:

      ai?.available
        ? "hybrid"
        : "rules",

    rules,

    ai,

    verdict,

    routing,

    trace,

    durationMs:
      now() -
      startedAt

  };


  logger.log(
    `[${stage}] ${subject}: ${verdict.headline} ` +
    `(mode=${decision.mode}, next=${routing.nextStep}, ${decision.durationMs}ms)`
  );


  return decision;

}


// ==================================================
// TRACE DESCRIPTIONS
//
// Kept generic so the pipeline never has to know the
// internals of either stage.
// ==================================================

function describeRules(
  stage,
  rules
) {

  if (
    stage ===
    "claim"
  ) {

    return `${
      rules?.flags?.length ||
      0
    } deterministic finding(s).`;

  }


  return `outcome=${
    rules?.outcome ||
    "unknown"
  } over ${
    rules?.results?.length ||
    0
  } original rule finding(s).`;

}


function describeAi(
  stage,
  ai
) {

  if (
    !ai?.available
  ) {

    return ai?.summary ||
      "AI review unavailable.";

  }


  if (
    stage ===
    "claim"
  ) {

    return `${
      ai.findings?.length ||
      0
    } AI finding(s), score ${
      ai.riskScore ?? 0
    }.`;

  }


  return `outcome=${
    ai.outcome ||
    "unknown"
  } over ${
    ai.results?.length ||
    0
  } original finding(s).`;

}
