// --------------------------------------------------
// FIXTURE NPPES SERVER
//
//   node fixtures/nppes-fixture-server.js
//   → http://localhost:3101/api/
//
// Then run the app against it:
//
//   NPPES_BASE_URL=http://localhost:3101/api/ node server.js
//
// Speaks the real NPPES v2.1 response shape, so not a
// line of verification code changes between demo and
// live. The agents cannot tell the difference — which
// is the point, because a demo that runs through a
// different code path than production has demonstrated
// nothing.
//
// WHY LOCAL RATHER THAN A HOSTED FAKE SITE:
//
//   - No network at demo time. Conference wifi is the
//     single most reliable way to lose a demo.
//   - Reproducible. A judge can ask you to run it
//     again and get the same answer.
//   - Lets you author scenarios the real registry
//     cannot give you — a deactivated NPI, a
//     misappropriated identity, prompt injection in a
//     registry field — without pointing at a real
//     practice to do it.
//   - Nothing to deploy, nothing to take down after.
// --------------------------------------------------

import express from "express";

import {
  FIXTURE_PROVIDERS,
  findByNumber,
  searchByName
} from "./providers.js";

const app = express();
const PORT = Number(process.env.FIXTURE_PORT || 3101);


// Real registries are not instant. A fixture that
// answers in 0ms hides timeout and latency bugs that
// then appear for the first time on stage.
const LATENCY_MS = Number(process.env.FIXTURE_LATENCY_MS || 180);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


// Strip the private _scenario / _expect keys so the
// payload is byte-shaped like the real API.
function publicRecord(provider) {

  const { _scenario, _expect, ...rest } = provider;

  return {
    ...rest,
    created_epoch: String(Date.parse(provider.basic.enumeration_date || "2010-01-01")),
    last_updated_epoch: String(Date.parse(provider.basic.last_updated || "2020-01-01"))
  };

}


app.get("/api/", async (req, res) => {

  await sleep(LATENCY_MS);

  // Simulate an outage to prove the system degrades to
  // "unknown" rather than inventing a finding:
  //   FIXTURE_OUTAGE=true node fixtures/nppes-fixture-server.js
  if (/^(1|true|yes)$/i.test(String(process.env.FIXTURE_OUTAGE || ""))) {
    return res.status(503).json({ error: "Simulated registry outage." });
  }

  const { number, organization_name, first_name, last_name, state, city } = req.query;

  const limit = Math.min(Number(req.query.limit || 10), 200);

  // ---- lookup by NPI ----
  if (number) {

    const match = findByNumber(number);

    // Absence is a first-class scenario. The real API
    // returns exactly this for an unknown NPI.
    if (!match) {
      return res.json({ result_count: 0, results: [] });
    }

    return res.json({
      result_count: 1,
      results: [publicRecord(match)]
    });

  }

  // ---- search by name ----
  if (organization_name || last_name) {

    const matches = searchByName({
      organization_name, first_name, last_name, state, city
    });

    return res.json({
      result_count: matches.length,
      results: matches.slice(0, limit).map(publicRecord)
    });

  }

  // The real API rejects a query with no usable
  // criteria, in-band, with HTTP 200.
  return res.json({
    Errors: [
      {
        description:
          "No valid search criteria. Supply number, organization_name, or last_name.",
        field: "number",
        number: "04"
      }
    ]
  });

});


// Convenience index — not part of the NPPES API.
app.get("/", (req, res) => {

  res.json({
    fixture: true,
    warning:
      "Invented providers for demonstration. Not the federal registry. Every NPI here " +
      "begins with 9, a range CMS has not assigned to anyone, so none of these can " +
      "collide with a real provider.",
    providers: FIXTURE_PROVIDERS.map((p) => ({
      npi: p.number,
      name: p.basic.organization_name ||
            `${p.basic.first_name || ""} ${p.basic.last_name || ""}`.trim(),
      scenario: p._scenario,
      expected: p._expect
    }))
  });

});


app.listen(PORT, () => {
  console.log(`\n  Fixture NPPES registry → http://localhost:${PORT}/api/`);
  console.log(`  ${FIXTURE_PROVIDERS.length} invented providers (all NPIs start with 9)\n`);
  console.log(`  Point the app at it:`);
  console.log(`    NPPES_BASE_URL=http://localhost:${PORT}/api/ node server.js\n`);
});
