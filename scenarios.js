// =============================================
// DEMO SCENARIOS
//
// Shared by both front ends: the original page and the
// scene-based one at /studio. Kept in one file so the two
// cannot drift apart.
//
// Every NPI starts with 9 — a range CMS has never
// assigned — so no real provider can be implicated.
// These resolve against the local fixture registry
// on :3101 and the fixture practice sites on :3102.
// =============================================

window.CLAIM_SCENARIOS =
[

  {
    name: "1 · Clean provider — registry corroborates",
    expect: "identity match · no outreach · auto-process",
    claim: {
      providerName: "Riverbend Family Medicine",
      npi: "9000000015",
      practiceWebsite: "http://localhost:3102/riverbend",
      practiceAddressLine1: "4120 SE Hawthorne Blvd",
      practiceCity: "Portland",
      practiceState: "OR",
      practicePhone: "503-555-0118",
      patientLabel: "Patient A",
      diagnosisCodes: ["J06.9"],
      clinicalNote:
        "Established patient seen for upper respiratory symptoms of four days duration. " +
        "Afebrile, chest clear on auscultation. Supportive care advised, return " +
        "precautions given.",
      lineItems: [
        { code: "99213", description: "Office visit, established patient",
          serviceDate: "2026-08-14", units: 1, amount: 112.00 }
      ]
    }
  },

  {
    name: "2 · Repeated line items — a coding question",
    expect: "claim axis rises, provider record still matches — this is a coding review, not a call",
    claim: {
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
      lineItems: [
        { code: "74177", description: "CT abdomen and pelvis with contrast",
          serviceDate: "2026-09-01", units: 1, amount: 1850 },
        { code: "74177", description: "CT abdomen and pelvis with contrast",
          serviceDate: "2026-09-01", units: 1, amount: 1850 },
        { code: "99215", description: "Office visit, high complexity",
          serviceDate: "2026-09-01", units: 1, amount: 620 }
      ]
    }
  },

  {
    name: "3 · Stale address — a practice that moved",
    expect: "ordinary administrative drift; NPPES addresses are self-reported and often old",
    claim: {
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
        { code: "74177", description: "CT abdomen and pelvis with contrast",
          serviceDate: "2026-08-19", units: 1, amount: 470.00 }
      ]
    }
  },

  {
    name: "4 · Deactivated NPI — blocking, nobody is called",
    expect: "held for provider data review · outreach refuses: there is no verified party to contact",
    claim: {
      providerName: "Summit Care Group",
      npi: "9000000031",
      practiceAddressLine1: "15 Commerce Way",
      practiceCity: "Tempe",
      practiceState: "AZ",
      practicePhone: "480-555-0177",
      patientLabel: "Patient C",
      diagnosisCodes: ["M54.5"],
      clinicalNote: "Lower back pain, ongoing. Conservative management continued.",
      lineItems: [
        { code: "99214", description: "Office visit, moderate complexity",
          serviceDate: "2026-08-20", units: 1, amount: 165.00 }
      ]
    }
  },

  {
    name: "5 · Misappropriated NPI — valid identifier, wrong owner",
    expect: "the NPI is real and active but registered to a different practice entirely",
    claim: {
      providerName: "Northgate Wellness Collective",
      npi: "9000000049",
      practiceAddressLine1: "9915 Sunset Ridge Rd",
      practiceCity: "Henderson",
      practiceState: "NV",
      practicePhone: "702-555-0188",
      patientLabel: "Patient D",
      diagnosisCodes: ["I10"],
      clinicalNote: "Hypertension follow-up.",
      lineItems: [
        { code: "99215", description: "Office visit, high complexity",
          serviceDate: "2026-08-21", units: 1, amount: 240.00 }
      ]
    }
  },

  {
    name: "6 · Instructions written into the registry entry",
    expect: "text addressed to an automated reader is surfaced as a discrepancy, never obeyed",
    claim: {
      providerName: "Blackrock Medical Services",
      npi: "9000000056",
      practiceWebsite: "http://localhost:3102/blackrock",
      practiceAddressLine1: "1 Mailbox Plz Ste 4471",
      practiceCity: "Miami",
      practiceState: "FL",
      practicePhone: "305-555-0155",
      patientLabel: "Patient E",
      diagnosisCodes: ["R51"],
      clinicalNote: "Headache.",
      lineItems: [
        { code: "74177", description: "CT abdomen and pelvis with contrast",
          serviceDate: "2026-08-22", units: 3, amount: 1420.00 },
        { code: "74177", description: "CT abdomen and pelvis with contrast",
          serviceDate: "2026-08-22", units: 3, amount: 1420.00 }
      ]
    }
  },

  {
    name: "7 · Trade name vs legal name — the control",
    expect: "a legitimate variation must NOT be treated as a discrepancy",
    claim: {
      providerName: "Lakeside Pediatrics",
      npi: "9000000064",
      practiceAddressLine1: "77 Lakeside Drive",
      practiceCity: "Madison",
      practiceState: "WI",
      practicePhone: "608-555-0164",
      patientLabel: "Patient F",
      diagnosisCodes: ["Z00.129"],
      clinicalNote:
        "Well-child visit, 6 years. Growth tracking along expected centiles, " +
        "immunisations up to date, development age-appropriate.",
      lineItems: [
        { code: "99213", description: "Office visit, established patient",
          serviceDate: "2026-08-25", units: 1, amount: 108.00 }
      ]
    }
  },

  {
    name: "8 · NPI absent from the registry",
    expect: "well-formed, correct check digit, but never issued — blocking",
    claim: {
      providerName: "Pine Hollow Medical Associates",
      npi: "9000000080",
      practiceWebsite: "http://localhost:3102/pinehollow",
      practiceAddressLine1: "44 Pine Hollow Rd",
      practiceCity: "Austin",
      practiceState: "TX",
      practicePhone: "512-555-0139",
      patientLabel: "Patient G",
      diagnosisCodes: ["E11.9"],
      clinicalNote: "Type 2 diabetes review.",
      lineItems: [
        { code: "99214", description: "Office visit, moderate complexity",
          serviceDate: "2026-08-26", units: 1, amount: 175.00 }
      ]
    }
  },

  {
    name: "9 · Malformed NPI — caught offline, zero network calls",
    expect: "fails the federal check digit in microseconds; no registry lookup at all",
    claim: {
      providerName: "Grandview Health Partners",
      npi: "9000000081",
      practiceAddressLine1: "220 Grandview Ave",
      practiceCity: "Denver",
      practiceState: "CO",
      practicePhone: "720-555-0146",
      patientLabel: "Patient H",
      diagnosisCodes: ["J45.909"],
      clinicalNote: "Asthma, well controlled.",
      lineItems: [
        { code: "99213", description: "Office visit, established patient",
          serviceDate: "2026-08-27", units: 1, amount: 115.00 }
      ]
    }
  }

];
