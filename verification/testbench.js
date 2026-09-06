// --------------------------------------------------
// TEST BENCH
//
// Runs a fixed subject through the pipeline and
// returns EVERY STAGE SEPARATELY, with its own timing
// and its own raw output, instead of collapsing them
// into one response.
//
// The point is to make the seam between the two kinds
// of step visible:
//
//   deterministic  same input, same output, forever.
//                  No model, and mostly no network.
//                  Fast enough that the number is in
//                  microseconds.
//
//   agentic        a model reading tool output and
//                  writing a JSON finding. Same input
//                  will not always give the same
//                  wording, and it takes seconds.
//
// Every stage below is tagged with which it is, so you
// can see exactly where the non-determinism enters and
// how much of the pipeline sits on either side of it.
//
// Nothing here is a separate implementation. Each
// stage calls the same function the real endpoint
// calls; the bench only instruments them.
// --------------------------------------------------

import { analyzeClaim } from "../analyzer.js";
import { analyzeAppeal, combineClaimAxis } from "../appeal.js";

import { verifyProviderCached, triage } from "./index.js";
import { verifyCompany } from "./orchestrator.js";
import { shouldEscalate } from "./outreach.js";

import {
  validateCikFormat,
  lookupByCik,
  compareSubmission as compareCompany
} from "./sources/edgar.js";

import { discoverFromWebsite } from "./sources/website.js";


async function stage(collector, meta, run) {

  const startedAt = Date.now();

  let output;
  let failed = false;

  try {
    output = await run();
  } catch (error) {
    failed = true;
    output = { error: error.message };
  }

  collector.push({
    n: collector.length + 1,
    ...meta,
    durationMs: Date.now() - startedAt,
    failed,
    output
  });

  return output;

}


// ==================================================
// A CLAIM
// ==================================================

export async function runClaimBench(claim) {

  const stages = [];

  const analysis = await stage(
    stages,
    {
      id: "analyze",
      title: "Claim content",
      fn: "analyzeClaim(claim)",
      kind: "deterministic",
      what:
        "Five arithmetic rules over the line items. No model, no network. Same claim in, " +
        "same numbers out, every time."
    },
    () => analyzeClaim(claim)
  );

  const verification = await stage(
    stages,
    {
      id: "verify",
      title: "Provider record",
      fn: "verifyProviderCached(claim)",
      kind: "agentic",
      what:
        "The orchestration. A specialist agent with four NPPES tools and no built-ins " +
        "decides whether the registry record corresponds to the submission. Cached by NPI, " +
        "so the second claim from the same provider skips this entirely."
    },
    () => verifyProviderCached(claim)
  );

  markCacheState(stages, verification);

  const routing = await stage(
    stages,
    {
      id: "triage",
      title: "Routing",
      fn: "triage(analysis, verification)",
      kind: "deterministic",
      what:
        "The only place the two axes meet. A pure function — no model, no I/O. A blocking " +
        "provider finding overrides the claim axis entirely."
    },
    () => triage(analysis, verification)
  );

  await stage(
    stages,
    {
      id: "escalate",
      title: "Outreach decision",
      fn: "shouldEscalate(verification)",
      kind: "deterministic",
      what:
        "Whether anyone should be contacted. Shown here as the decision only — the live " +
        "endpoint also drafts and queues. A blocking discrepancy never escalates: there is " +
        "no verified party to call."
    },
    () => shouldEscalate(verification)
  );

  return {
    subjectType: "claim",
    subject: claim,
    stages,
    verdict: summarise(analysis, verification, routing)
  };

}


// ==================================================
// AN APPEAL
//
// Same pipeline plus one stage. An appeal is a claim
// that has been denied once, so the claim analysis
// still runs over its line items — the appeal rules
// are added on top rather than replacing them.
// ==================================================

export async function runAppealBench(appeal) {

  const stages = [];

  const claimAnalysis = await stage(
    stages,
    {
      id: "analyze",
      title: "Claim content",
      fn: "analyzeClaim(appeal)",
      kind: "deterministic",
      what:
        "An appeal carries line items like any claim, so the ordinary claim rules run over " +
        "them unchanged."
    },
    () => analyzeClaim(appeal)
  );

  const appealAnalysis = await stage(
    stages,
    {
      id: "appeal",
      title: "Appeal form",
      fn: "analyzeAppeal(appeal)",
      kind: "deterministic",
      what:
        "Rules that exist only because this is an appeal: filing window, appealed amount " +
        "against billed, documentation, denial reason. About the FORM of the appeal, never " +
        "the motive for filing one."
    },
    () => analyzeAppeal(appeal)
  );

  const analysis = await stage(
    stages,
    {
      id: "combine",
      title: "Combined claim axis",
      fn: "combineClaimAxis(claim, appeal)",
      kind: "deterministic",
      what:
        "Added, not averaged. Averaging would let clean line items silently cancel a late " +
        "filing, and those are unrelated facts about unrelated things."
    },
    () => combineClaimAxis(claimAnalysis, appealAnalysis)
  );

  const verification = await stage(
    stages,
    {
      id: "verify",
      title: "Provider record",
      fn: "verifyProviderCached(appeal)",
      kind: "agentic",
      what:
        "Identical to the claim path. The provider axis does not care that this document " +
        "is an appeal — it is asking about the registry record either way."
    },
    () => verifyProviderCached(appeal)
  );

  markCacheState(stages, verification);

  const routing = await stage(
    stages,
    {
      id: "triage",
      title: "Routing",
      fn: "triage(combined, verification)",
      kind: "deterministic",
      what: "Same function, same two axes, same matrix."
    },
    () => triage(analysis, verification)
  );

  await stage(
    stages,
    {
      id: "escalate",
      title: "Outreach decision",
      fn: "shouldEscalate(verification)",
      kind: "deterministic",
      what: "Driven by the provider axis only. An appeal is not a reason to ring anyone."
    },
    () => shouldEscalate(verification)
  );

  return {
    subjectType: "appeal",
    subject: appeal,
    stages,
    verdict: summarise(analysis, verification, routing)
  };

}


// ==================================================
// A REAL COMPANY, AGAINST A REAL FEDERAL REGISTRY
//
// Same orchestration, different registry. This one
// makes live calls to SEC EDGAR and to the company's
// own public website, so it is the honest end-to-end
// test: nothing here is a fixture.
//
// The stages are deliberately unrolled so the
// deterministic work is visible on its own before the
// agent runs over the same ground.
// ==================================================

export async function runCompanyBench(subject) {

  const stages = [];

  await stage(
    stages,
    {
      id: "cik-format",
      title: "Identifier format",
      fn: "validateCikFormat(cik)",
      kind: "deterministic",
      what:
        "Offline, no network. Note what it does NOT establish: a CIK carries no check " +
        "digit, so unlike an NPI this cannot catch a transposed digit. A pass means only " +
        "that the value is shaped like a CIK."
    },
    () => validateCikFormat(subject.cik)
  );

  const lookup = await stage(
    stages,
    {
      id: "edgar-lookup",
      title: "Federal registry lookup",
      fn: "lookupByCik(cik)",
      kind: "deterministic",
      what:
        "A live call to SEC EDGAR — US federal, public domain, published so entities can " +
        "be verified against it. Network, but not a model: the same CIK returns the same " +
        "record. EDGAR has no status flag, so activity is reported as filing recency and " +
        "labelled as the inference it is."
    },
    () => lookupByCik(subject.cik)
  );

  await stage(
    stages,
    {
      id: "compare",
      title: "Field comparison",
      fn: "compareSubmission(submitted, record)",
      kind: "deterministic",
      what:
        "Token-overlap similarity per field, computed here so no model is left eyeballing " +
        "whether two strings look alike. Former names are checked too — companies rename, " +
        "and that is ordinary."
    },
    () =>
      lookup?.found
        ? compareCompany(
            {
              companyName: subject.companyName,
              stateOfIncorporation: subject.stateOfIncorporation,
              city: subject.city,
              ticker: subject.ticker
            },
            lookup.record
          )
        : { compared: false, reason: lookup?.reason }
  );

  await stage(
    stages,
    {
      id: "website",
      title: "Website corroboration",
      fn: "discoverFromWebsite(url)",
      kind: "deterministic",
      what:
        "Fetches the company's real public page and extracts contacts by regex. The page " +
        "is never read by a model, so nothing written on it can change what happens next — " +
        "and because the company authors that page, a match here is corroboration, never " +
        "evidence about itself."
    },
    () =>
      subject.website
        ? discoverFromWebsite(subject.website, {
            registryRecord: {
              legalName: lookup?.record?.legalName,
              practiceAddress: {
                city: lookup?.record?.businessAddress?.city,
                state: lookup?.record?.businessAddress?.state,
                phone: lookup?.record?.phone
              }
            },
            claim: {},
            allowLocal: false
          })
        : { skipped: true, reason: "No website supplied." }
  );

  const verification = await stage(
    stages,
    {
      id: "agent",
      title: "Company agent",
      fn: "verifyCompany(subject)",
      kind: "agentic",
      what:
        "Here is where the non-determinism enters. The agent re-runs the tools above under " +
        "its own judgement and writes a JSON finding. Same tool confinement as the provider " +
        "side — four EDGAR tools, no built-ins, 45-second cap — and the same adjudication " +
        "afterwards, including the blocking rule and the coverage cap."
    },
    () => verifyCompany(subject)
  );

  return {
    subjectType: "company",
    subject,
    stages,
    verdict: {
      claimAxis: null,
      providerAxis: {
        score: verification?.dataConfidenceScore ?? null,
        band: verification?.confidenceBand ?? null,
        blocking: Boolean(verification?.blocking)
      },
      routing: null,
      note:
        "There is no claim axis here — there is no claim. This track exercises the " +
        "provider-axis machinery on its own, against a different registry."
    }
  };

}


// A cached result and a fresh one are the same shape,
// and the difference is the whole reason this stage is
// sometimes 0 ms and sometimes fifteen seconds. Say
// which happened rather than leaving the reader to
// infer it from a duration.
function markCacheState(stages, verification) {

  const entry = stages.find((s) => s.id === "verify");

  if (!entry) {
    return;
  }

  // verifyProviderCached() stamps fromCache:false on a
  // fresh result and returns the stored object
  // untouched on a hit.
  const ranLive = verification?.fromCache === false;

  entry.cacheHit = !ranLive;

  entry.kind = ranLive ? "agentic" : "deterministic";

  entry.what = ranLive
    ? entry.what + "  ·  Ran live: this is the model working."
    : entry.what +
      "  ·  CACHE HIT — the agent did not run. This is a stored result for this NPI, " +
      "which is why the stage cost nothing. Clear the cache to watch it run.";

}


function summarise(analysis, verification, routing) {

  return {
    claimAxis: {
      priority: analysis?.reviewPriority ?? null,
      level: analysis?.reviewLevel ?? null,
      observations: analysis?.observations?.length ?? 0
    },
    providerAxis: {
      score: verification?.dataConfidenceScore ?? null,
      band: verification?.confidenceBand ?? null,
      blocking: Boolean(verification?.blocking)
    },
    routing: {
      decision: routing?.decision ?? null,
      queue: routing?.queue ?? null,
      headline: routing?.headline ?? null
    }
  };

}
