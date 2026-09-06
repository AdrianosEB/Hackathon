// --------------------------------------------------
// DEMO CLAIMS
//
// One claim per fixture scenario, shaped exactly as
// the browser posts to /api/claims/analyze.
//
//   node fixtures/demo-claims.js          # list them
//   node fixtures/demo-claims.js --post   # send to a running server
//
// Note that the CPT codes here are used only as
// identifiers within a claim, and the descriptions are
// plain English rather than AMA CPT descriptors — the
// descriptors are copyrighted and need a licence.
// --------------------------------------------------

import { pathToFileURL } from "node:url";

export const DEMO_CLAIMS = [

  {
    _scenario: "1. Clean provider",
    _expect: "identity pass · probable · no outreach · auto_process",
    claimNumber: "CLM-20001",
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
      "Afebrile, chest clear on auscultation. Supportive care advised, return precautions given.",
    lineItems: [
      { code: "99213", description: "Office visit, established patient", serviceDate: "2026-08-14", units: 1, amount: 112.00 }
    ]
  },


  {
    _scenario: "2. Stale address — legitimate practice that moved",
    _expect: "identity warn · unverified · PHONE OUTREACH QUEUED",
    claimNumber: "CLM-20002",
    providerName: "Cascade Imaging Partners",
    npi: "9000000023",
    practiceWebsite: "http://localhost:3102/cascade",
    // Practice relocated; NPPES still lists the old suite.
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
      { code: "74177", description: "CT abdomen and pelvis with contrast", serviceDate: "2026-08-19", units: 1, amount: 470.00 }
    ]
  },


  {
    _scenario: "3. Deactivated NPI",
    _expect: "identity mismatch · BLOCKING · hold · NO outreach",
    claimNumber: "CLM-20003",
    providerName: "Summit Care Group",
    npi: "9000000031",
    practiceAddressLine1: "15 Commerce Way",
    practiceCity: "Tempe",
    practiceState: "AZ",
    practicePhone: "480-555-0177",
    patientLabel: "Patient C",
    diagnosisCodes: ["M54.5"],
    clinicalNote: "Low back pain, ongoing management.",
    lineItems: [
      { code: "99214", description: "Office visit, moderate complexity", serviceDate: "2026-08-20", units: 1, amount: 168.00 }
    ]
  },


  {
    _scenario: "4. Misappropriated NPI — valid identifier, wrong owner",
    _expect: "identity mismatch · BLOCKING — the NPI belongs to someone else entirely",
    claimNumber: "CLM-20004",
    // Billing name bears no resemblance to the registrant.
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
      { code: "99215", description: "Office visit, high complexity", serviceDate: "2026-08-21", units: 1, amount: 240.00 }
    ]
  },


  {
    _scenario: "5. Prompt injection written into the federal registry entry",
    _expect: "injection DETECTED and surfaced as a discrepancy — must NOT return match",
    claimNumber: "CLM-20005",
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
      { code: "74177", description: "CT abdomen and pelvis with contrast", serviceDate: "2026-08-22", units: 3, amount: 1420.00 },
      { code: "74177", description: "CT abdomen and pelvis with contrast", serviceDate: "2026-08-22", units: 3, amount: 1420.00 }
    ]
  },


  {
    _scenario: "6. Trade name vs legal name — the control",
    _expect: "identity pass — a legitimate variation must NOT be flagged",
    claimNumber: "CLM-20006",
    // Bills as the trade name; NPPES holds the LLC name.
    providerName: "Lakeside Pediatrics",
    npi: "9000000064",
    practiceAddressLine1: "77 Lakeside Drive",
    practiceCity: "Madison",
    practiceState: "WI",
    practicePhone: "608-555-0164",
    patientLabel: "Patient F",
    diagnosisCodes: ["Z00.129"],
    clinicalNote:
      "Well-child visit, 6 years. Growth tracking along expected centiles, immunisations " +
      "up to date, development age-appropriate.",
    lineItems: [
      { code: "99213", description: "Office visit, established patient", serviceDate: "2026-08-25", units: 1, amount: 108.00 }
    ]
  },


  {
    _scenario: "7. NPI absent from the registry",
    _expect: "identity mismatch · BLOCKING — well-formed but never issued",
    claimNumber: "CLM-20007",
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
      { code: "99214", description: "Office visit, moderate complexity", serviceDate: "2026-08-26", units: 1, amount: 175.00 }
    ]
  },


  {
    _scenario: "8. Malformed NPI — caught offline, zero network calls",
    _expect: "identity mismatch · BLOCKING in microseconds, no registry lookup at all",
    claimNumber: "CLM-20008",
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
      { code: "99213", description: "Office visit, established patient", serviceDate: "2026-08-27", units: 1, amount: 115.00 }
    ]
  }

];


// --------------------------------------------------

const strip = (claim) => {
  const { _scenario, _expect, ...rest } = claim;
  return rest;
};


// Only act when run directly. Importing this module
// for its DEMO_CLAIMS export must stay silent — a
// module that prints on import corrupts the output of
// anything that consumes it.
const runDirectly =
  import.meta.url === pathToFileURL(process.argv[1] || "").href;


if (runDirectly && process.argv[2] === "--post") {

  const base = process.env.APP_URL || "http://localhost:3000";

  for (const claim of DEMO_CLAIMS) {

    process.stdout.write(`\n${claim._scenario}\n  expect: ${claim._expect}\n`);

    try {

      const response = await fetch(`${base}/api/claims/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(strip(claim))
      });

      const body = await response.json();

      if (!response.ok) {
        console.log(`  ERROR ${response.status}:`, JSON.stringify(body).slice(0, 200));
        continue;
      }

      const v = body.verification || {};

      console.log(
        `  got:    ${String(v.confidenceBand).padEnd(11)} score=${String(v.dataConfidenceScore).padEnd(5)}` +
        ` blocked=${String(Boolean(v.blocking)).padEnd(5)} → ${body.routing?.decision}`
      );

      if (body.outreach?.queued) {
        console.log(`  outreach: tier ${body.outreach.tier} ${body.outreach.channel} — ${body.outreach.status}`);
      }

    } catch (error) {
      console.log(`  request failed: ${error.message}`);
    }

  }

  console.log("");

} else if (runDirectly) {

  console.log("\nDemo claims (run with --post against a live server):\n");

  for (const claim of DEMO_CLAIMS) {
    console.log(`  ${claim._scenario}`);
    console.log(`    NPI ${claim.npi}  ${claim.providerName}`);
    console.log(`    expect: ${claim._expect}\n`);
  }

}

export { strip };
