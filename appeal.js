// --------------------------------------------------
// APPEAL ANALYZER
//
// An appeal is a claim that has already been denied
// once and is being resubmitted with an argument
// attached. It carries everything a claim does, so
// analyzeClaim() still runs over its line items — this
// module only adds the observations that exist because
// it is an appeal.
//
// --------------------------------------------------
// VOCABULARY — the same rules as analyzer.js, and one
// more that matters specifically here
// --------------------------------------------------
//
// A provider filing an appeal is exercising a right.
// The overwhelming majority of appeals are filed by
// practices that believe, correctly or not, that a
// denial was wrong — and a substantial share of them
// win. Nothing in this file may be phrased as though
// appealing were itself a signal about anyone.
//
// So the observations below are about the FORM of the
// appeal — is it in time, is it internally consistent,
// does it carry the documentation it says it does —
// never about the motive for filing it.
//
// Every observation names an ordinary explanation. If
// you cannot name one, you have not understood the
// signal well enough to ship it.
// --------------------------------------------------


// Most US commercial payers allow 180 days from the
// denial notice for a first-level appeal. Medicare
// Advantage is 60 for some categories, ERISA plans
// often 180. This is a demo default and is stated as
// one — a real deployment reads the plan's own rule.
const APPEAL_WINDOW_DAYS = 180;


// Denial categories a first-level appeal can actually
// resolve by supplying paperwork, as opposed to ones
// that need a different remedy.
const DOCUMENTABLE_DENIALS = new Set([
  "medical_necessity",
  "missing_documentation",
  "coding_error",
  "prior_authorization"
]);


export function analyzeAppeal(appeal) {

  const observations = [];

  let priority = 0;


  // ==================================================
  // 1. Filed outside the appeal window
  // ==================================================

  const denialDate = parseDate(appeal.denialDate);
  const filedDate = parseDate(appeal.appealFiledDate);

  if (denialDate && filedDate) {

    const days = Math.round((filedDate - denialDate) / 86_400_000);

    if (days > APPEAL_WINDOW_DAYS) {

      priority += 30;

      observations.push({
        type: "appeal_window",
        weight: "high",
        observation:
          `Filed ${days} days after the denial, against a ${APPEAL_WINDOW_DAYS}-day window.`,
        evidence:
          `Denial dated ${appeal.denialDate}, appeal filed ${appeal.appealFiledDate}.`,
        innocentExplanation:
          "Windows vary by plan and by denial category, and several restart on a corrected " +
          "notice. A late appeal is usually a calendar problem in the billing office, and " +
          "good cause extensions exist. Confirm the plan's own rule before acting on this."
      });

    } else if (days < 0) {

      priority += 22;

      observations.push({
        type: "appeal_predates_denial",
        weight: "high",
        observation: "The appeal is dated before the denial it responds to.",
        evidence: `Denial ${appeal.denialDate}, appeal ${appeal.appealFiledDate}.`,
        innocentExplanation:
          "Almost always a keying error or a timezone artefact in an intake form, not " +
          "anything about the appeal itself."
      });

    }

  }


  // ==================================================
  // 2. Appealed amount exceeds what was billed
  // ==================================================

  const billed = Number(appeal.originalBilledAmount || 0);
  const appealed = Number(appeal.appealedAmount || 0);

  if (billed > 0 && appealed > billed) {

    priority += 26;

    observations.push({
      type: "appealed_amount_exceeds_billed",
      weight: "high",
      observation:
        `The appeal asks for $${appealed.toFixed(2)} against $${billed.toFixed(2)} ` +
        `originally billed.`,
      evidence: `Difference of $${(appealed - billed).toFixed(2)}.`,
      innocentExplanation:
        "Corrected coding legitimately raises an amount, and some plans allow interest on " +
        "a late payment to be added. It needs the corrected claim attached to read as " +
        "ordinary, which is what to look for."
    });

  }


  // ==================================================
  // 3. No documentation attached
  //
  // Only worth noting where documentation is the thing
  // that would resolve the denial. An appeal arguing a
  // plan-interpretation point does not need records,
  // and flagging it for their absence would be wrong.
  // ==================================================

  const documents = Array.isArray(appeal.supportingDocuments)
    ? appeal.supportingDocuments.filter(Boolean)
    : [];

  const denialReason = String(appeal.denialReason || "").trim();

  if (documents.length === 0 && DOCUMENTABLE_DENIALS.has(denialReason)) {

    priority += 20;

    observations.push({
      type: "no_supporting_documentation",
      weight: "medium",
      observation:
        `No documentation is attached to an appeal against a "${denialReason}" denial.`,
      evidence: "supportingDocuments was empty.",
      innocentExplanation:
        "Records are frequently sent under separate cover, by fax or portal upload, and " +
        "arrive detached from the appeal itself. Check for a separate submission before " +
        "treating the appeal as unsupported."
    });

  }


  // ==================================================
  // 4. Payment details changed since the last payment
  //
  // This is the one that matters, and it is arithmetic.
  //
  // The appeal-side attack that actually moves money is
  // not a bad clinical argument — it is a correct,
  // payable appeal for a real service by a real
  // provider, with the remit-to swapped. The claim was
  // legitimate. The payment goes somewhere else.
  //
  // It is the same principle as rule 1 in
  // verification/outreach.js: payment details on a
  // submitted document are asserted by whoever
  // submitted it. They are compared against what is
  // already on file, never trusted because they arrived
  // on official-looking paper.
  //
  // Weighted high and deliberately so. A practice that
  // genuinely changed banks will confirm it in one
  // phone call to the number in the registry, and that
  // call costs far less than paying the wrong account.
  // ==================================================

  const remitTo = String(appeal.remitTo || "").trim();
  const remitOnFile = String(appeal.remitToOnFile || "").trim();

  if (remitTo && remitOnFile && normalize(remitTo) !== normalize(remitOnFile)) {

    priority += 34;

    observations.push({
      type: "remit_to_changed",
      weight: "high",
      observation:
        "The payment details on this appeal differ from the ones on file for this provider.",
      evidence:
        `Appeal says "${remitTo}". On file from the last payment: "${remitOnFile}".`,
      innocentExplanation:
        "Practices change banks, get acquired, and move to new billing companies, and any " +
        "of those legitimately changes a remit-to. The point is not that it changed — it " +
        "is that a change should be confirmed with the practice on the registry number " +
        "before money moves, rather than accepted because it arrived on the appeal."
    });

  }


  // ==================================================
  // 5. The appellant is not the provider who billed
  //
  // Cheap and catches a surprising amount. A third
  // party appealing on a provider's behalf is entirely
  // ordinary — billing companies and recovery vendors
  // do it constantly — but it needs authority on file,
  // and that is a different question from whether the
  // NPIs match.
  // ==================================================

  const appellantNpi = String(appeal.appellantNpi || "").replace(/\D/g, "");
  const billingNpi = String(appeal.npi || "").replace(/\D/g, "");

  if (appellantNpi && billingNpi && appellantNpi !== billingNpi) {

    priority += 24;

    observations.push({
      type: "appellant_differs_from_biller",
      weight: "high",
      observation:
        `The appeal is filed under NPI ${appellantNpi}, but the claim was billed under ` +
        `${billingNpi}.`,
      evidence: "appellantNpi does not match the NPI on the original claim.",
      innocentExplanation:
        "Third-party billers, clearinghouses and recovery vendors appeal on providers' " +
        "behalf as a matter of routine, and group practices file under a group NPI. What " +
        "this asks for is the authority on file, not an explanation."
    });

  }


  // ==================================================
  // 6. The appeal does not engage the denial reason
  //
  // Deterministic and deliberately shallow: it checks
  // whether a reason was recorded at all and whether
  // the narrative is long enough to contain an
  // argument. It does NOT judge the argument — that is
  // a clinical and contractual question, and not one
  // a string length can answer.
  // ==================================================

  const narrative = String(appeal.appealNarrative || "").trim();

  if (!denialReason) {

    priority += 12;

    observations.push({
      type: "denial_reason_missing",
      weight: "medium",
      observation: "No denial reason is recorded against this appeal.",
      evidence: "denialReason was empty.",
      innocentExplanation:
        "Usually an intake gap — the reason is on the original remittance advice and was " +
        "not carried across. It says nothing about the merits."
    });

  }

  if (narrative.length > 0 && narrative.length < 120) {

    priority += 14;

    observations.push({
      type: "brief_appeal_narrative",
      weight: "medium",
      observation: `The appeal narrative is ${narrative.length} characters.`,
      evidence:
        "Character count only. This is a measure of length, not of whether the argument " +
        "is a good one.",
      innocentExplanation:
        "A short appeal is often the correct one — 'prior authorisation 8841X was on file, " +
        "attached' resolves a denial in a sentence. Length is weak evidence of anything."
    });

  }


  // ==================================================

  priority = Math.min(100, Math.round(priority));

  let reviewLevel = "routine";

  if (priority >= 60) {
    reviewLevel = "priority";
  } else if (priority >= 25) {
    reviewLevel = "review";
  }

  return {

    documentType: "appeal",

    originalClaimNumber: appeal.originalClaimNumber || null,
    denialReason: denialReason || null,

    appealWindowDays: APPEAL_WINDOW_DAYS,

    daysToFile:
      denialDate && filedDate
        ? Math.round((filedDate - denialDate) / 86_400_000)
        : null,

    appealPriority: priority,
    appealReviewLevel: reviewLevel,

    observations

  };

}


// Payment strings arrive formatted a dozen ways. Compare
// them on their digits and letters, not their punctuation,
// so "****4471" and "**** 4471" do not read as a change.
function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}


function parseDate(value) {

  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;

}


// --------------------------------------------------
// Combine the two claim-axis readings
//
// An appeal has both: the line items still get the
// ordinary claim analysis, and the appeal form gets
// its own. They are added rather than averaged —
// averaging would let a clean set of line items
// silently cancel a late filing, which are unrelated
// facts about unrelated things.
// --------------------------------------------------

export function combineClaimAxis(claimAnalysis, appealAnalysis) {

  const priority = Math.min(
    100,
    claimAnalysis.reviewPriority + appealAnalysis.appealPriority
  );

  let reviewLevel = "routine";

  if (priority >= 60) {
    reviewLevel = "priority";
  } else if (priority >= 25) {
    reviewLevel = "review";
  }

  return {
    ...claimAnalysis,
    documentType: "appeal",
    reviewPriority: priority,
    reviewLevel,
    observations: [...claimAnalysis.observations, ...appealAnalysis.observations],
    appeal: appealAnalysis
  };

}
