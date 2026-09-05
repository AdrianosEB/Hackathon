// --------------------------------------------------
// PUBLIC API for the verification layer
//
// server.js should import from here and nowhere else.
// --------------------------------------------------

import { verifyProvider } from "./orchestrator.js";
import { coverageReport } from "./registry.js";

import {
  getCachedVerification,
  cacheVerification,
  sourceFingerprint,
  migrateClaimsTable
} from "./cache.js";

export { migrateClaimsTable };
export { coverageReport } from "./registry.js";
export { SOURCES, enabledSources, disabledSources } from "./registry.js";

export {
  escalate,
  shouldEscalate,
  listOutreach,
  getOutreach,
  approveOutreach,
  rejectOutreach,
  recordOutcome,
  dispatch,
  composeCallScript,
  providerFacts,
  assertNoClaimContent,
  callsAlreadySentTo,
  POLICY as OUTREACH_POLICY
} from "./outreach.js";


// Dispatch adapters. Importing one does NOT arm it —
// see verification/adapters/vapi.js for the two
// switches that must both be on before a phone rings.
export {
  createVapiAdapter,
  previewVapiCall,
  resolveTarget as resolveVapiTarget
} from "./adapters/vapi.js";

export {
  requireOutreachAuth,
  resolveApprover,
  authenticateOutreach
} from "./auth.js";


// --------------------------------------------------
// Verify, with cache
// --------------------------------------------------

export async function verifyProviderCached(claim) {

  const fingerprint = sourceFingerprint(coverageReport());

  const cached = getCachedVerification(claim.npi, fingerprint);

  if (cached) {
    return cached;
  }

  const result = await verifyProvider(claim);

  cacheVerification(claim.npi, claim.providerName, result);

  return { ...result, fromCache: false };

}


// --------------------------------------------------
// TRIAGE
//
// Two scores, one routing decision.
//
// The axes answer different questions and stay
// separate right up to this function. Collapsing them
// earlier destroys the thing that makes the output
// useful: a claim with billing anomalies from a
// well-matched provider, and an ordinary claim from a
// provider whose record we could not match, are the
// same number and completely different problems. One
// is a coding question. The other is a data question.
//
// Nothing here concludes anything about intent. Every
// output names WHAT to look at and WHO should look.
// --------------------------------------------------

export function triage(analysis, verification) {

  const claimReview = analysis.reviewLevel;         // routine | review | priority
  const providerBand = verification.confidenceBand; // confirmed | probable | incomplete | conflicting

  // A blocking discrepancy is a data problem, not a
  // coding one. Routing it to a claims reviewer wastes
  // their time and buries it.
  if (verification.blocking) {

    return {
      decision: "hold",
      queue: "provider_data_review",
      headline: "Provider record could not be matched",
      reason: verification.blockingReason,
      note:
        "This concerns the provider record, not the coding. It should not be worked as a " +
        "claim edit, and it is not a conclusion about the provider — the registry data " +
        "and the submission disagree, and someone needs to find out why."
    };

  }

  const providerUnmatched =
    providerBand === "conflicting" || providerBand === "incomplete";

  if (claimReview === "priority" && providerUnmatched) {

    return {
      decision: "priority_review",
      queue: "combined_review",
      headline: "Billing observations on a claim we could not match to a provider record",
      reason:
        "Both axes need attention: the claim content scored high for review and the " +
        "provider record could not be corroborated.",
      note:
        "The combination is what matters. Either on its own is common and usually " +
        "explains itself; together they are worth a person's time."
    };

  }

  if (providerBand === "conflicting") {

    return {
      decision: "priority_review",
      queue: "provider_data_review",
      headline: "Submitted provider details conflict with the registry",
      reason: verification.rationale,
      note:
        "The claim's own contents look ordinary. What needs resolving is the difference " +
        "between what was submitted and what the registry holds."
    };

  }

  if (claimReview === "priority") {

    return {
      decision: "review",
      queue: "coding_review",
      headline: "Billing observations on a claim from a matched provider",
      reason: "The provider record matches. The line items are what need checking.",
      note: "Most often a coding or documentation question."
    };

  }

  if (claimReview === "review" || providerBand === "incomplete") {

    return {
      decision: "review",
      queue: "general",
      headline: "Worth a look",
      reason:
        claimReview === "review"
          ? "Moderate review priority on the claim's contents."
          : "The provider record could not be fully corroborated with the sources " +
            "currently enabled. That is a statement about our coverage, not about them.",
      note: null
    };

  }

  return {
    decision: "auto_process",
    queue: null,
    headline: "Nothing to review",
    reason: "Claim contents and provider record both came back clean.",
    note:
      verification.coverage?.completeness < 0.6
        ? "Only part of the intended verification ran — see coverage."
        : null
  };

}
