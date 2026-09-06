// --------------------------------------------------
// TEST BENCH SUBJECTS
//
// Fixed inputs, so a run is comparable to the last one.
//
// The claim and the appeal use invented providers whose
// NPIs all begin with 9 — a range CMS has never
// assigned — resolved against the local fixture
// registry. No real practice can be implicated by
// anything in this file.
//
// The company subjects are the opposite on purpose:
// real, public, US-federal-registered entities, looked
// up live against SEC EDGAR and their own public
// websites. Nothing about them is a fixture, which is
// what makes them worth having — the provider track
// can only ever be as convincing as its fixtures.
// --------------------------------------------------


export const TEST_CLAIM = {

  claimNumber: "BENCH-CLAIM-01",

  providerName: "Riverbend Family Medicine",
  npi: "9000000015",
  practiceWebsite: "http://localhost:3102/riverbend",
  practiceAddressLine1: "4120 SE Hawthorne Blvd",
  practiceCity: "Portland",
  practiceState: "OR",
  practicePhone: "503-555-0118",

  patientLabel: "Patient A",
  diagnosisCodes: ["R10.9"],
  clinicalNote: "Abdominal pain. Imaging ordered.",

  // Built to trip three of the five deterministic
  // rules, so there is something to look at: the same
  // code twice on one date, both lines far above the
  // reference figure, and a note too short for a
  // high-intensity code.
  lineItems: [
    {
      code: "74177",
      description: "CT abdomen and pelvis with contrast",
      serviceDate: "2026-09-01",
      units: 1,
      amount: 1850.0
    },
    {
      code: "74177",
      description: "CT abdomen and pelvis with contrast",
      serviceDate: "2026-09-01",
      units: 1,
      amount: 1850.0
    },
    {
      code: "99215",
      description: "Office visit, high complexity",
      serviceDate: "2026-09-01",
      units: 1,
      amount: 620.0
    }
  ]

};


export const TEST_APPEAL = {

  claimNumber: "BENCH-APPEAL-01",

  // What is being appealed.
  documentType: "appeal",
  originalClaimNumber: "CLM-20441",
  denialReason: "medical_necessity",
  denialDate: "2026-01-12",
  appealFiledDate: "2026-08-28",
  originalBilledAmount: 470.0,
  appealedAmount: 640.0,
  supportingDocuments: [],
  appealNarrative: "Service was medically necessary. Please reprocess.",

  // The signal that actually moves money. A correct,
  // payable appeal for a real service by a real
  // provider — with the remit-to swapped. Compared
  // against what is already on file rather than
  // trusted because it arrived on the appeal.
  remitTo: "ACH ****8817 / Meridian Billing Services LLC",
  remitToOnFile: "ACH ****4471 / Cascade Imaging Partners",

  // Filed by a third party. Ordinary in itself —
  // billing companies appeal constantly — but it asks
  // for authority on file.
  appellantNpi: "9000000072",

  providerName: "Cascade Imaging Partners",
  npi: "9000000023",
  practiceWebsite: "http://localhost:3102/cascade",
  practiceAddressLine1: "1500 Denny Way Ste 410",
  practiceCity: "Seattle",
  practiceState: "WA",
  practicePhone: "206-555-0142",

  patientLabel: "Patient B",
  diagnosisCodes: ["R10.9"],
  clinicalNote:
    "Abdominal pain, non-localised. CT abdomen and pelvis with contrast ordered to " +
    "exclude acute intra-abdominal pathology.",

  lineItems: [
    {
      code: "74177",
      description: "CT abdomen and pelvis with contrast",
      serviceDate: "2026-01-04",
      units: 1,
      amount: 470.0
    }
  ]

  // Trips six appeal rules at once: filed 228 days
  // after the denial against a 180-day window, asking
  // for more than was billed, no documents attached to
  // a medical-necessity denial, a narrative under 120
  // characters, payment details that differ from the
  // ones on file, and an appellant NPI that is not the
  // one that billed.

};


// --------------------------------------------------
// Real companies, real registry
//
// Chosen because they are open-source businesses with
// public SEC registrations and genuinely public
// websites — so the whole path can be exercised
// against live federal data without touching anyone's
// private information.
// --------------------------------------------------

export const TEST_COMPANIES = {

  gitlab: {
    label: "GitLab — should corroborate",
    expect: "CIK exists, name/state/city/ticker all agree, filing regularly",
    subject: {
      submissionRef: "BENCH-CO-01",
      companyName: "GitLab Inc.",
      cik: "1653482",
      stateOfIncorporation: "DE",
      city: "San Francisco",
      ticker: "GTLB",
      website: "https://about.gitlab.com/"
    }
  },

  mongodb: {
    label: "MongoDB — the Delaware control",
    expect:
      "Incorporated in Delaware, headquartered in New York. Must NOT be reported as a " +
      "discrepancy — this is the most common arrangement in US corporate law.",
    subject: {
      submissionRef: "BENCH-CO-02",
      companyName: "MongoDB, Inc.",
      cik: "1441816",
      stateOfIncorporation: "DE",
      city: "New York",
      ticker: "MDB",
      website: "https://www.mongodb.com/"
    }
  },

  mismatched: {
    label: "Wrong owner — a real CIK, the wrong name",
    expect:
      "The identifier is real and active but registered to a different company. This is " +
      "the shape of identifier misuse, and it should come back blocking.",
    subject: {
      submissionRef: "BENCH-CO-03",
      companyName: "Northgate Analytics Holdings",
      cik: "1653482",
      stateOfIncorporation: "NV",
      city: "Las Vegas",
      ticker: "NGAH",
      website: null
    }
  },

  absent: {
    label: "Absent — well-formed, never issued",
    expect: "Format passes, EDGAR holds nothing. Existence is a separate question.",
    subject: {
      submissionRef: "BENCH-CO-04",
      companyName: "Pine Hollow Systems",
      cik: "9999999",
      stateOfIncorporation: "TX",
      city: "Austin",
      ticker: null,
      website: null
    }
  },

  malformed: {
    label: "Malformed — caught offline",
    expect: "Rejected before any network call is made.",
    subject: {
      submissionRef: "BENCH-CO-05",
      companyName: "Grandview Data Group",
      cik: "not-a-cik",
      stateOfIncorporation: "CO",
      city: "Denver",
      ticker: null,
      website: null
    }
  }

};
