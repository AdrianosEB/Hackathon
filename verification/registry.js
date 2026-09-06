// --------------------------------------------------
// VERIFICATION SOURCE REGISTRY
//
// SCOPE RULE — every source in this file is either:
//
//   (a) US federal government data, published as
//       public domain specifically so that payers can
//       screen against it, or
//   (b) our own database.
//
// Nothing here has terms of service to breach, no
// scraping, no third-party content licences, no
// caching restrictions. That is a deliberate ceiling,
// not an accident of what we got round to building.
//
// DELIBERATELY EXCLUDED, do not add without a lawyer:
//
//   - Google Places / Maps. Useful, but the Maps
//     Platform terms restrict caching and forbid
//     deriving a competing dataset. Scraping Maps
//     outside the API breaches those terms outright.
//   - Fetching the provider's own website. The subject
//     of the check controls that page, so anything it
//     says is evidence they authored about themselves.
//   - Open web search on a provider's name. Reliably
//     surfaces material about similarly named
//     businesses, which then reads as a finding about
//     this one.
//   - State board / Secretary of State scraping. Most
//     prohibit automated access in their terms, and a
//     narrow CFAA reading does not make breach of
//     contract go away.
// --------------------------------------------------

function flag(name, defaultValue = false) {

  const raw = process.env[name];

  if (raw === undefined) {
    return defaultValue;
  }

  return /^(1|true|yes|on)$/i.test(String(raw).trim());

}


export const SOURCES = {

  identity: {

    id: "identity",

    label: "Provider identity",

    agent: "identity-verifier",

    enabled: flag("VERIFY_IDENTITY", true),

    // CMS NPPES. Disseminated under FOIA precisely so
    // that provider identifiers can be verified.
    provenance: "US federal registry (CMS NPPES), public domain",

    weight: 1.0,

    question:
      "Does this NPI exist, is it active, and does the registry record correspond to " +
      "the provider named on the claim?"

  },


  sanctions: {

    id: "sanctions",

    label: "Federal exclusions",

    agent: "sanctions-verifier",

    enabled: flag("VERIFY_SANCTIONS", false),

    // HHS-OIG publishes the LEIE so that payers and
    // providers screen against it. There is no public
    // API — you download the monthly CSV.
    provenance: "US federal list (HHS-OIG LEIE), public domain",

    setupNote:
      "Load the OIG LEIE monthly CSV into a local table, then set VERIFY_SANCTIONS=true. " +
      "Confirm any name match against SSN/EIN via OIG's searchable database before acting " +
      "on it — OIG's own guidance requires this, and acting on a bare name match is how " +
      "you accuse the wrong person.",

    weight: 1.0,

    question:
      "Is this provider or entity excluded from federal healthcare programs?"

  },


  scope: {

    id: "scope",

    label: "Scope of practice",

    agent: "scope-verifier",

    enabled: flag("VERIFY_SCOPE", false),

    // NUCC taxonomy codes are freely published; CPT
    // numbers are used here only as identifiers within
    // a claims transaction. Do NOT ship CPT
    // descriptors without an AMA licence.
    provenance: "NUCC taxonomy (free) compared against codes already on the claim",

    setupNote:
      "Needs a taxonomy-to-procedure plausibility table. Note that CPT descriptors are " +
      "AMA-copyrighted — build the table on code numbers, not on their text.",

    weight: 0.7,

    question:
      "Can a provider of this specialty plausibly perform the procedures being billed?"

  },


  history: {

    id: "history",

    label: "Billing history",

    agent: "history-verifier",

    enabled: flag("VERIFY_HISTORY", false),

    provenance: "our own claims database",

    setupNote:
      "Reads our own claims table. Meaningless until there is volume — turn it on once " +
      "the database holds a few hundred claims.",

    weight: 0.7,

    question:
      "What has this NPI done in our own records — submission velocity, prior observations, " +
      "sudden pattern changes, addresses shared with other NPIs?"

  }

};


// --------------------------------------------------
// Dimensions that can BLOCK
//
// A finding here is not worth "some negative points."
// It ends the assessment. Additive scoring is the
// classic failure mode: six soft passes quietly
// outvote one blocking discrepancy and a federally excluded
// provider sails through with a 71.
// --------------------------------------------------

export const BLOCKING_DIMENSIONS = new Set([
  "identity",
  "sanctions"
]);


export function enabledSources() {
  return Object.values(SOURCES).filter((source) => source.enabled);
}


export function disabledSources() {
  return Object.values(SOURCES).filter((source) => !source.enabled);
}


export function coverageReport() {

  const checked = enabledSources();
  const skipped = disabledSources();

  const totalWeight = Object.values(SOURCES)
    .reduce((sum, source) => sum + source.weight, 0);

  const checkedWeight = checked
    .reduce((sum, source) => sum + source.weight, 0);

  return {

    checked: checked.map((source) => source.id),

    skipped: skipped.map((source) => ({
      id: source.id,
      label: source.label,
      reason: source.setupNote || "Disabled."
    })),

    completeness: Number((checkedWeight / totalWeight).toFixed(2))

  };

}
