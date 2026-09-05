import "dotenv/config";
import express from "express";

import { analyzeClaim } from "./analyzer.js";

import {
  createClaim,
  getClaim,
  listClaims,
  getDashboardStats
} from "./db.js";

const app = express();

const PORT = Number(process.env.PORT || 3000);


// -------------------------
// Middleware
// -------------------------

app.use(
  express.json({
    limit: "5mb"
  })
);

// Serve frontend files from /website
app.use(
  "/website",
  express.static("website")
);

// Load homepage at localhost:3000
app.get("/", (req, res) => {
  res.sendFile("index.html", {
    root: "website"
  });
});


// -------------------------
// Health check
// -------------------------

app.get("/api/health", (req, res) => {
  res.json({
    ok: true
  });
});


// -------------------------
// Get all claims
// -------------------------

app.get("/api/claims", (req, res) => {

  const claims = listClaims();

  res.json(claims);

});


// -------------------------
// Get one claim
// -------------------------

app.get("/api/claims/:id", (req, res) => {

  const id = Number(req.params.id);

  const claim = getClaim(id);

  if (!claim) {

    return res.status(404).json({
      error: "Claim not found."
    });

  }

  res.json(claim);

});


// -------------------------
// Dashboard
// -------------------------

app.get("/api/dashboard", (req, res) => {

  res.json({

    stats: getDashboardStats(),

    claims: listClaims(50)

  });

});


// -------------------------
// Analyze a claim
// -------------------------

app.post("/api/claims/analyze", (req, res) => {

  const claim = req.body || {};

  const errors = validateClaim(claim);


  if (errors.length > 0) {

    return res.status(400).json({
      errors
    });

  }


  // Clean data received from browser

  const cleanClaim = {

    claimNumber:
      String(claim.claimNumber).trim(),

    providerName:
      String(claim.providerName).trim(),

    patientLabel:
      String(claim.patientLabel || "").trim(),

    diagnosisCodes:
      Array.isArray(claim.diagnosisCodes)
        ? claim.diagnosisCodes.map(String)
        : [],

    clinicalNote:
      String(claim.clinicalNote || "").trim(),

    lineItems:
      claim.lineItems.map((item) => ({

        code:
          String(item.code || "").trim(),

        description:
          String(item.description || "").trim(),

        serviceDate:
          String(item.serviceDate || "").trim(),

        units:
          Number(item.units || 1),

        amount:
          Number(item.amount || 0)

      }))
  };


  // Run our detection engine

  const analysis = analyzeClaim(cleanClaim);


  // Store claim + analysis in SQL

  const savedClaim =
    createClaim(cleanClaim, analysis);


  res
    .status(201)
    .json(savedClaim);

});


// -------------------------
// Validate claim input
// -------------------------

function validateClaim(claim) {

  const errors = [];


  if (!String(claim.claimNumber || "").trim()) {

    errors.push(
      "Claim number is required."
    );

  }


  if (!String(claim.providerName || "").trim()) {

    errors.push(
      "Provider name is required."
    );

  }


  if (
    !Array.isArray(claim.lineItems) ||
    claim.lineItems.length === 0
  ) {

    errors.push(
      "At least one line item is required."
    );

  } else {

    claim.lineItems.forEach(
      (item, index) => {

        if (!String(item.code || "").trim()) {

          errors.push(
            `Line ${index + 1}: procedure code is required.`
          );

        }


        if (!(Number(item.amount) >= 0)) {

          errors.push(
            `Line ${index + 1}: amount must be a number.`
          );

        }

      }
    );

  }


  return errors;

}


// -------------------------
// Start server
// -------------------------

app.listen(PORT, () => {

  console.log(
    `Claim Integrity running at http://localhost:${PORT}`
  );

});