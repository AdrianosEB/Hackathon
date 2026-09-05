import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("claim-integrity.db");

db.exec("PRAGMA journal_mode = WAL;");


// --------------------------------------------------
// Claims table
//
// Column names follow the neutral vocabulary:
//   review_priority / review_level / observations
//
// Not risk_score / risk_level / flags. What is stored
// here is how much attention a claim warrants, not a
// judgement about the party that sent it — and a
// column called `flags` invites everything downstream
// to talk about "flagged providers".
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

    review_priority INTEGER NOT NULL DEFAULT 0,
    review_amount REAL NOT NULL DEFAULT 0,
    review_level TEXT NOT NULL DEFAULT 'routine',

    observations TEXT,
    line_items TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

  );

`);


// --------------------------------------------------
// Migrate an older database
//
// If you already ran the earlier version, the table
// has risk_score / risk_level / flags. SQLite can
// rename columns in place, so existing rows survive.
// Runs once, then becomes a no-op.
// --------------------------------------------------

function renameLegacyColumns() {

  const columns = new Set(
    db.prepare("PRAGMA table_info(claims)").all().map((c) => c.name)
  );

  const renames = [
    ["risk_score", "review_priority"],
    ["risk_level", "review_level"],
    ["flags", "observations"]
  ];

  for (const [from, to] of renames) {

    if (columns.has(from) && !columns.has(to)) {

      db.exec(`ALTER TABLE claims RENAME COLUMN ${from} TO ${to};`);

    }

  }

  // Old rows carry the legacy level values.
  const levels = new Set(
    db.prepare("PRAGMA table_info(claims)").all().map((c) => c.name)
  );

  if (levels.has("review_level")) {
    db.exec(`UPDATE claims SET review_level = 'routine'  WHERE review_level = 'low';`);
    db.exec(`UPDATE claims SET review_level = 'priority' WHERE review_level = 'high';`);
  }

}

renameLegacyColumns();


// --------------------------------------------------

export function createClaim(claim, analysis) {

  const statement = db.prepare(`

    INSERT INTO claims (
      claim_number, provider_name, patient_label,
      diagnosis_codes, clinical_note, total_billed,
      review_priority, review_amount, review_level,
      observations, line_items,
      npi, practice_address_line1, practice_city,
      practice_state, practice_phone
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

  `);

  const result = statement.run(

    claim.claimNumber,
    claim.providerName,
    claim.patientLabel || null,
    JSON.stringify(claim.diagnosisCodes || []),
    claim.clinicalNote || null,

    analysis.totalBilled,
    analysis.reviewPriority,
    analysis.reviewAmount,
    analysis.reviewLevel,

    JSON.stringify(analysis.observations),
    JSON.stringify(claim.lineItems),

    claim.npi || null,
    claim.practiceAddressLine1 || null,
    claim.practiceCity || null,
    claim.practiceState || null,
    claim.practicePhone || null

  );

  return getClaim(result.lastInsertRowid);

}


// --------------------------------------------------
// Record the provider axis against a claim
//
// migrateClaimsTable() adds these columns but nothing
// wrote to them, so the dashboard could only ever show
// one of the two axes. The whole point of the design is
// that they stay separate and both get shown.
// --------------------------------------------------

export function saveClaimVerification(id, verification) {

  db.prepare(`
    UPDATE claims
    SET data_confidence_score = ?,
        confidence_band = ?,
        verification = ?
    WHERE id = ?
  `).run(
    verification?.dataConfidenceScore ?? null,
    verification?.confidenceBand || "incomplete",
    JSON.stringify(verification ?? null),
    Number(id)
  );

  return getClaim(id);

}


export function getClaim(id) {
  return normalize(
    db.prepare("SELECT * FROM claims WHERE id = ?").get(id)
  );
}


export function listClaims(limit = 100) {
  return db
    .prepare("SELECT * FROM claims ORDER BY id DESC LIMIT ?")
    .all(limit)
    .map(normalize);
}


// --------------------------------------------------
// Dashboard
//
// "needs_review" rather than "flagged". A count of
// claims a person should look at, not a count of
// accusations.
// --------------------------------------------------

export function getDashboardStats() {

  const row = db.prepare(`

    SELECT
      COUNT(*) AS claims_analyzed,

      SUM(CASE WHEN review_level != 'routine' THEN 1 ELSE 0 END) AS needs_review,

      COALESCE(SUM(review_amount), 0) AS review_amount,

      SUM(CASE WHEN observations LIKE '%repeated_line%' THEN 1 ELSE 0 END)
        AS repeated_line_observations

    FROM claims

  `).get();

  return {
    claimsAnalyzed: row.claims_analyzed || 0,
    needsReview: row.needs_review || 0,
    reviewAmount: Number(row.review_amount || 0),
    repeatedLineObservations: row.repeated_line_observations || 0
  };

}


function normalize(row) {

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    claimNumber: row.claim_number,
    providerName: row.provider_name,
    npi: row.npi || null,
    practiceAddressLine1: row.practice_address_line1 || null,
    practiceCity: row.practice_city || null,
    practiceState: row.practice_state || null,
    practicePhone: row.practice_phone || null,
    patientLabel: row.patient_label,
    diagnosisCodes: parse(row.diagnosis_codes, []),
    clinicalNote: row.clinical_note,
    totalBilled: row.total_billed,
    reviewPriority: row.review_priority,
    reviewAmount: row.review_amount,
    reviewLevel: row.review_level,
    observations: parse(row.observations, []),
    lineItems: parse(row.line_items, []),

    // The provider axis, if it has been recorded.
    // Deliberately a separate key: it never merges into
    // the claim's own numbers.
    verification: parse(row.verification, null),

    createdAt: row.created_at
  };

}


function parse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
