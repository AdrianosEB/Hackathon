import { DatabaseSync } from "node:sqlite";


const db =
  new DatabaseSync(
    "claim-integrity.db"
  );


// WAL improves SQLite reliability
// when multiple reads/writes happen.

db.exec("PRAGMA journal_mode = WAL;");


// --------------------------------------------------
// Create database table
// --------------------------------------------------

db.exec(`

  CREATE TABLE IF NOT EXISTS claims (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    claim_number TEXT NOT NULL,

    provider_name TEXT NOT NULL,

    patient_label TEXT,

    diagnosis_codes TEXT,

    clinical_note TEXT,

    total_billed REAL NOT NULL DEFAULT 0,

    risk_score INTEGER NOT NULL DEFAULT 0,

    review_amount REAL NOT NULL DEFAULT 0,

    risk_level TEXT NOT NULL DEFAULT 'low',

    flags TEXT,

    line_items TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

  );

`);


// --------------------------------------------------
// Insert analyzed claim
// --------------------------------------------------

export function createClaim(
  claim,
  analysis
) {

  const statement =
    db.prepare(`

      INSERT INTO claims (

        claim_number,

        provider_name,

        patient_label,

        diagnosis_codes,

        clinical_note,

        total_billed,

        risk_score,

        review_amount,

        risk_level,

        flags,

        line_items

      )

      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )

    `);


  const result =
    statement.run(

      claim.claimNumber,

      claim.providerName,

      claim.patientLabel || null,

      JSON.stringify(
        claim.diagnosisCodes || []
      ),

      claim.clinicalNote || null,

      analysis.totalBilled,

      analysis.riskScore,

      analysis.reviewAmount,

      analysis.riskLevel,

      JSON.stringify(
        analysis.flags
      ),

      JSON.stringify(
        claim.lineItems
      )

    );


  return getClaim(
    result.lastInsertRowid
  );

}


// --------------------------------------------------
// Get individual claim
// --------------------------------------------------

export function getClaim(id) {

  const row =
    db
      .prepare(
        "SELECT * FROM claims WHERE id = ?"
      )
      .get(id);


  return normalize(row);

}


// --------------------------------------------------
// List claims
// --------------------------------------------------

export function listClaims(
  limit = 100
) {

  const rows =
    db
      .prepare(`
        SELECT *
        FROM claims
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(limit);


  return rows.map(
    normalize
  );

}


// --------------------------------------------------
// Dashboard statistics
// --------------------------------------------------

export function getDashboardStats() {

  const row =
    db.prepare(`

      SELECT

        COUNT(*) AS claims_analyzed,

        SUM(
          CASE
            WHEN risk_level != 'low'
            THEN 1
            ELSE 0
          END
        ) AS claims_flagged,

        COALESCE(
          SUM(review_amount),
          0
        ) AS review_amount,

        SUM(
          CASE
            WHEN flags LIKE '%duplicate%'
            THEN 1
            ELSE 0
          END
        ) AS duplicate_flags

      FROM claims

    `).get();


  return {

    claimsAnalyzed:
      row.claims_analyzed || 0,

    claimsFlagged:
      row.claims_flagged || 0,

    reviewAmount:
      Number(
        row.review_amount || 0
      ),

    duplicateFlags:
      row.duplicate_flags || 0

  };

}


// --------------------------------------------------
// Convert SQL row to frontend-friendly object
// --------------------------------------------------

function normalize(row) {

  if (!row) {

    return null;

  }


  return {

    id:
      row.id,

    claimNumber:
      row.claim_number,

    providerName:
      row.provider_name,

    patientLabel:
      row.patient_label,

    diagnosisCodes:
      parse(
        row.diagnosis_codes,
        []
      ),

    clinicalNote:
      row.clinical_note,

    totalBilled:
      row.total_billed,

    riskScore:
      row.risk_score,

    reviewAmount:
      row.review_amount,

    riskLevel:
      row.risk_level,

    flags:
      parse(
        row.flags,
        []
      ),

    lineItems:
      parse(
        row.line_items,
        []
      ),

    createdAt:
      row.created_at

  };

}


// --------------------------------------------------
// Safely parse JSON stored inside SQLite text field
// --------------------------------------------------

function parse(
  value,
  fallback
) {

  try {

    return value
      ? JSON.parse(value)
      : fallback;

  } catch {

    return fallback;

  }

}