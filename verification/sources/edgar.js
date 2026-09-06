// --------------------------------------------------
// SEC EDGAR — COMPANY REGISTRY
//
// A second registry, in a different domain, wired to
// the same orchestration.
//
// WHY THIS SOURCE AND NOT ANOTHER
//
// verification/registry.js sets a scope rule: every
// source is either US federal government data
// published as public domain so that it can be
// screened against, or our own database. EDGAR is
// squarely the first. It is also the closest
// structural analogue to NPPES that exists:
//
//   NPPES                     EDGAR
//   ---------------------     -----------------------
//   NPI, 10 digits            CIK, 10 digits
//   legal / organisation      entity legal name
//   other_names, trade name   formerNames[]
//   practice address          business address
//   taxonomy code             SIC code
//   status A / D              filing recency
//   endpoints                 phone, EIN, exchanges
//
// So the same three questions apply unchanged: does
// this identifier exist, is the entity still active,
// and does the record correspond to what was
// submitted?
//
// NOT USED, deliberately, for the same reasons the
// provider side excludes them: no Google/Maps lookup,
// no open web search on a company name, and the
// company's own website is read for CORROBORATION
// only — never as evidence about itself, because the
// company authors that page.
//
// SEC FAIR ACCESS
//
// The SEC requires a descriptive User-Agent carrying a
// real contact address, and asks for no more than ten
// requests a second. Both are honoured below. Set
// SEC_CONTACT_EMAIL to your own address; requests are
// refused outright without a plausible one.
// --------------------------------------------------

const SUBMISSIONS_BASE = "https://data.sec.gov/submissions";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

const REQUEST_TIMEOUT_MS = 8000;


function contactEmail() {
  return String(process.env.SEC_CONTACT_EMAIL || "").trim();
}


function userAgent() {

  const email = contactEmail();

  if (!email) {
    throw new Error(
      "SEC_CONTACT_EMAIL is not set. EDGAR's fair-access policy requires a real contact " +
      "address in the User-Agent, and refuses requests without one. Set it to your own " +
      "email before using this source."
    );
  }

  return `ClaimIntegrity-Verification/1.0 (${email})`;

}


// --------------------------------------------------
// Deterministic: is this even a well-formed CIK?
//
// Runs offline. A CIK is up to ten digits and carries
// no check digit — unlike an NPI there is no Luhn to
// verify, so this is a format check and says so. It
// still catches the common cases (letters, absurd
// lengths, zero) before any network call is made.
// --------------------------------------------------

export function validateCikFormat(cik) {

  const raw = String(cik ?? "").trim();
  const digits = raw.replace(/\D/g, "");

  if (!digits) {
    return {
      valid: false,
      reason: "No digits supplied.",
      note: "A CIK is a numeric SEC identifier of up to ten digits."
    };
  }

  if (digits.length > 10) {
    return {
      valid: false,
      digits,
      reason: `${digits.length} digits. A CIK is at most ten.`
    };
  }

  if (Number(digits) === 0) {
    return { valid: false, digits, reason: "CIK 0 is not issued." };
  }

  return {

    valid: true,

    digits,

    padded: digits.padStart(10, "0"),

    // Said plainly so nobody reads more into a pass
    // than it carries.
    note:
      "Format only. A CIK has no check digit, so unlike an NPI this cannot detect a " +
      "transposed digit — it only confirms the value could be a CIK. Existence is a " +
      "separate lookup."

  };

}


async function fetchJson(url) {

  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent(),
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (response.status === 404) {
    return { found: false, status: 404 };
  }

  if (!response.ok) {
    throw new Error(`EDGAR returned HTTP ${response.status}.`);
  }

  return { found: true, data: await response.json() };

}


// --------------------------------------------------
// Look a company up by CIK
// --------------------------------------------------

export async function lookupByCik(cik) {

  const format = validateCikFormat(cik);

  if (!format.valid) {
    return { found: false, reason: format.reason, checkedNetwork: false };
  }

  let result;

  try {
    result = await fetchJson(`${SUBMISSIONS_BASE}/CIK${format.padded}.json`);
  } catch (error) {
    return {
      found: false,
      error: true,
      reason:
        error.name === "TimeoutError"
          ? `EDGAR did not respond within ${REQUEST_TIMEOUT_MS}ms.`
          : error.message,
      note:
        "This is an outage on our side, not a finding about the company. It must not be " +
        "recorded as one."
    };
  }

  if (!result.found) {
    return {
      found: false,
      reason: `CIK ${format.padded} is well-formed but EDGAR holds no entity under it.`,
      checkedNetwork: true
    };
  }

  return { found: true, record: shapeRecord(result.data) };

}


function shapeRecord(data) {

  const recent = data.filings?.recent || {};

  const latestFilingDate = (recent.filingDate || [])[0] || null;

  const daysSinceFiling = latestFilingDate
    ? Math.floor((Date.now() - new Date(latestFilingDate).getTime()) / 86_400_000)
    : null;

  const business = data.addresses?.business || {};

  return {

    cik: String(data.cik || "").padStart(10, "0"),

    legalName: data.name || null,

    formerNames: (data.formerNames || []).map((entry) => entry.name).filter(Boolean),

    entityType: data.entityType || null,

    // EDGAR has no status flag. Activity is inferred
    // from filing recency, and the inference is stated
    // rather than hidden: a dormant registrant and a
    // company that simply files annually look similar
    // over a short window.
    latestFilingDate,
    latestFilingForm: (recent.form || [])[0] || null,
    daysSinceLatestFiling: daysSinceFiling,

    filingActivity:
      daysSinceFiling === null
        ? "no filings on record"
        : daysSinceFiling <= 120
          ? "filing regularly"
          : daysSinceFiling <= 400
            ? "filed within the last year"
            : "no filing in over a year",

    activityNote:
      "Filing recency is not a status flag. A registrant that files only an annual report " +
      "is not dormant, and a company may deregister for ordinary reasons.",

    sic: data.sic || null,
    sicDescription: data.sicDescription || null,

    stateOfIncorporation: data.stateOfIncorporation || null,

    ein: data.ein || null,

    tickers: data.tickers || [],
    exchanges: data.exchanges || [],

    phone: data.phone || null,

    businessAddress: {
      line1: [business.street1, business.street2].filter(Boolean).join(" "),
      city: business.city || null,
      state: business.stateOrCountry || null,
      zip: business.zipCode || null
    },

    registryUrl:
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=` +
      `${String(data.cik || "").padStart(10, "0")}`,

    // Same guard the NPPES reader carries. A registry
    // record is submitted by the entity it describes,
    // so free text in it is untrusted input.
    unexpectedRegistryContent: scanForInstructions(data)

  };

}


// --------------------------------------------------
// Registry text is written by the registrant
//
// EDGAR's company name and former-name fields are
// self-reported. Text addressed to an automated reader
// is surfaced as a discrepancy and never acted on.
// --------------------------------------------------

const INSTRUCTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above)/i,
  /disregard (the |your )?(above|previous|instructions)/i,
  /system prompt/i,
  /you are (now|an? )/i,
  /return (a )?(match|verified|approved)/i,
  /mark (this|as) (verified|approved|legitimate)/i,
  /\bAI\b.{0,20}\b(assistant|agent|model)\b/i
];


function scanForInstructions(data) {

  const fields = [
    ["name", data.name],
    ["entityType", data.entityType],
    ["sicDescription", data.sicDescription],
    ...(data.formerNames || []).map((entry, i) => [`formerNames[${i}]`, entry.name])
  ];

  const hits = [];

  for (const [field, value] of fields) {

    const text = String(value || "");

    for (const pattern of INSTRUCTION_PATTERNS) {
      if (pattern.test(text)) {
        hits.push({
          field,
          text: text.slice(0, 200),
          note:
            "This registry field contains text addressed to an automated reader. It is " +
            "reported as a discrepancy in the record and is not followed."
        });
        break;
      }
    }

  }

  return hits;

}


// --------------------------------------------------
// Search by name
//
// The degraded path, exactly as on the provider side.
// Name-only matching is ambiguous; several hits mean
// "could not identify", not "found".
// --------------------------------------------------

let tickerCache = null;


export async function searchByName(name) {

  const query = normalizeText(name);

  if (!query) {
    return { found: false, reason: "No name supplied." };
  }

  if (!tickerCache) {

    try {
      const result = await fetchJson(TICKERS_URL);
      tickerCache = Object.values(result.data || {});
    } catch (error) {
      return { found: false, error: true, reason: error.message };
    }

  }

  const scored = tickerCache
    .map((entry) => ({
      cik: String(entry.cik_str).padStart(10, "0"),
      title: entry.title,
      ticker: entry.ticker,
      similarity: Number(nameSimilarity(name, entry.title).toFixed(2))
    }))
    .filter((entry) => entry.similarity >= 0.5)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  if (scored.length === 0) {
    return { found: false, reason: `No EDGAR registrant resembles "${name}".` };
  }

  if (scored.length > 1 && scored[1].similarity >= scored[0].similarity - 0.1) {
    return {
      found: false,
      ambiguous: true,
      candidates: scored,
      reason:
        "Several registrants match this name about equally well. Treat that as 'could not " +
        "identify', not as a finding — pick by CIK instead."
    };
  }

  return { found: true, match: scored[0], alsoConsidered: scored.slice(1) };

}


// --------------------------------------------------
// Compare what was submitted against the record
//
// Computed here, not eyeballed by a model. The agent
// receives structured agreement ratings and reasons
// about those.
// --------------------------------------------------

export function compareSubmission(submitted, record) {

  const comparisons = [];

  // ---- name, including former names ----

  const similarity = nameSimilarity(submitted.companyName, record.legalName);

  let bestFormer = null;

  for (const former of record.formerNames || []) {
    const score = nameSimilarity(submitted.companyName, former);
    if (!bestFormer || score > bestFormer.score) {
      bestFormer = { name: former, score: Number(score.toFixed(2)) };
    }
  }

  const bestScore = Math.max(similarity, bestFormer?.score ?? 0);

  comparisons.push({
    field: "companyName",
    submitted: submitted.companyName || null,
    registry: record.legalName,
    similarity: Number(similarity.toFixed(2)),
    matchedFormerName: bestFormer && bestFormer.score > similarity ? bestFormer : null,
    agreement: bestScore >= 0.8 ? "strong" : bestScore >= 0.45 ? "partial" : "weak",
    note:
      bestFormer && bestFormer.score > similarity
        ? "Matches a former name on file. Companies rename; this is ordinary."
        : "Legal name on EDGAR often differs from the trading name in ordinary ways."
  });

  // ---- state of incorporation ----

  if (submitted.stateOfIncorporation) {

    const submittedState = String(submitted.stateOfIncorporation).trim().toUpperCase();
    const registryState = String(record.stateOfIncorporation || "").toUpperCase();

    comparisons.push({
      field: "stateOfIncorporation",
      submitted: submittedState,
      registry: registryState || null,
      agreement: submittedState === registryState ? "strong" : "weak",
      note:
        "State of incorporation is not the state of operation. A Delaware company " +
        "headquartered in California is the overwhelmingly common case, not a discrepancy."
    });

  }

  // ---- headquarters city / state ----

  if (submitted.city) {

    const match =
      normalizeText(submitted.city) === normalizeText(record.businessAddress.city);

    comparisons.push({
      field: "city",
      submitted: submitted.city,
      registry: record.businessAddress.city,
      agreement: match ? "strong" : "weak",
      note:
        "EDGAR business addresses are self-reported and updated at filing time, so they " +
        "lag real moves."
    });

  }

  // ---- ticker ----

  if (submitted.ticker) {

    const submittedTicker = String(submitted.ticker).trim().toUpperCase();

    comparisons.push({
      field: "ticker",
      submitted: submittedTicker,
      registry: record.tickers,
      agreement: record.tickers.includes(submittedTicker) ? "strong" : "weak",
      note: "A ticker is issued by the exchange, so agreement here is a strong signal."
    });

  }

  return {

    cik: record.cik,
    legalName: record.legalName,
    filingActivity: record.filingActivity,
    daysSinceLatestFiling: record.daysSinceLatestFiling,
    registryUrl: record.registryUrl,

    comparisons,

    summary: {
      nameAgreement: comparisons.find((c) => c.field === "companyName")?.agreement,
      fieldsCompared: comparisons.length,
      fieldsAgreeing: comparisons.filter((c) => c.agreement === "strong").length
    }

  };

}


// --------------------------------------------------
// Shared string helpers
//
// Same approach as the provider side: mechanical
// questions are answered mechanically.
// --------------------------------------------------

function normalizeText(value) {

  return String(value || "")
    .toLowerCase()
    .replace(/\b(inc|llc|llp|ltd|corp|corporation|co|company|holdings|group|the|and|of|nv|plc|sa|ag)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

}


function nameSimilarity(a, b) {

  const tokensA = new Set(normalizeText(a).split(" ").filter(Boolean));
  const tokensB = new Set(normalizeText(b).split(" ").filter(Boolean));

  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const token of tokensA) {
    if (tokensB.has(token)) {
      shared += 1;
    }
  }

  return shared / new Set([...tokensA, ...tokensB]).size;

}
