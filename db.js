import {
  DatabaseSync
} from "node:sqlite";



// =============================================
// Database
// =============================================

const db =
  new DatabaseSync(
    "claims.db"
  );


db.exec(
  "PRAGMA journal_mode = WAL;"
);



// =============================================
// Claims table
// =============================================

db.exec(`

  CREATE TABLE IF NOT EXISTS claims (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    claim_number TEXT NOT NULL,

    provider_name TEXT NOT NULL,

    patient_label TEXT,

    diagnosis_codes TEXT,

    clinical_note TEXT,

    line_items TEXT NOT NULL,

    total_billed REAL NOT NULL DEFAULT 0,

    risk_score INTEGER NOT NULL DEFAULT 0,

    review_amount REAL NOT NULL DEFAULT 0,

    risk_level TEXT NOT NULL DEFAULT 'low',

    flags TEXT NOT NULL DEFAULT '[]',

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

  );

`);



// =============================================
// Database migration helper
// =============================================

function ensureColumn(
  tableName,
  columnName,
  definition
) {

  const columns =
    db
      .prepare(
        `PRAGMA table_info(${tableName})`
      )
      .all();


  const exists =
    columns.some(
      (column) =>
        column.name ===
        columnName
    );


  if (
    !exists
  ) {

    db.exec(
      `ALTER TABLE ${tableName}
       ADD COLUMN ${columnName} ${definition}`
    );

  }

}



// =============================================
// Add new hybrid rating columns
// =============================================

ensureColumn(
  "claims",
  "rules_risk_level",
  "TEXT"
);


ensureColumn(
  "claims",
  "ai_risk_level",
  "TEXT"
);



// =============================================
// Vapi calls table
// =============================================

db.exec(`

  CREATE TABLE IF NOT EXISTS vapi_calls (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    claim_number TEXT NOT NULL,

    vapi_call_id TEXT NOT NULL UNIQUE,

    status TEXT NOT NULL DEFAULT 'created',

    ended_reason TEXT,

    transcript TEXT,

    messages TEXT,

    started_at TEXT,

    ended_at TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

  );

`);



// =============================================
// Severity helper for old claims
// =============================================

function deriveRiskLevel(
  flags
) {

  if (
    !Array.isArray(flags)
  ) {

    return "low";

  }


  if (
    flags.some(
      (flag) =>
        flag.severity === "high"
    )
  ) {

    return "high";

  }


  if (
    flags.some(
      (flag) =>
        flag.severity === "medium"
    )
  ) {

    return "review";

  }


  return "low";

}



// =============================================
// Calculate rules rating from saved findings
//
// Used as fallback for claims saved before the
// new database columns existed.
// =============================================

function deriveRulesRiskLevel(
  flags
) {

  const ruleFlags =

    Array.isArray(flags)

      ? flags.filter(
          (flag) => {

            const sources =
              Array.isArray(
                flag.detectedBy
              )
                ? flag.detectedBy
                : ["rules"];


            return sources.includes(
              "rules"
            );

          }
        )

      : [];


  return deriveRiskLevel(
    ruleFlags
  );

}



// =============================================
// Calculate AI rating from saved findings
//
// Used as fallback for older claims.
// =============================================

function deriveAiRiskLevel(
  flags
) {

  const aiSeverities =
    [];


  if (
    !Array.isArray(flags)
  ) {

    return "unavailable";

  }


  for (
    const flag
    of flags
  ) {

    if (
      flag.aiReview?.severity
    ) {

      aiSeverities.push({

        severity:
          flag.aiReview.severity

      });

      continue;

    }


    if (
      Array.isArray(
        flag.detectedBy
      ) &&
      flag.detectedBy.includes(
        "ai"
      )
    ) {

      aiSeverities.push({

        severity:
          flag.severity

      });

    }

  }


  if (
    aiSeverities.length === 0
  ) {

    return "unavailable";

  }


  return deriveRiskLevel(
    aiSeverities
  );

}



// =============================================
// Normalize claim database row
// =============================================

function normalizeClaim(
  row
) {

  if (
    !row
  ) {

    return null;

  }


  let diagnosisCodes =
    [];


  let lineItems =
    [];


  let flags =
    [];


  try {

    diagnosisCodes =
      JSON.parse(
        row.diagnosis_codes ||
        "[]"
      );

  } catch {

    diagnosisCodes =
      [];

  }


  try {

    lineItems =
      JSON.parse(
        row.line_items ||
        "[]"
      );

  } catch {

    lineItems =
      [];

  }


  try {

    flags =
      JSON.parse(
        row.flags ||
        "[]"
      );

  } catch {

    flags =
      [];

  }



  const rulesRiskLevel =

    row.rules_risk_level ||

    deriveRulesRiskLevel(
      flags
    );


  const aiRiskLevel =

    row.ai_risk_level ||

    deriveAiRiskLevel(
      flags
    );


  return {

    id:
      row.id,

    claimNumber:
      row.claim_number,

    providerName:
      row.provider_name,

    patientLabel:
      row.patient_label,

    diagnosisCodes,

    clinicalNote:
      row.clinical_note,

    lineItems,

    totalBilled:
      Number(
        row.total_billed ||
        0
      ),

    riskScore:
      Number(
        row.risk_score ||
        0
      ),

    reviewAmount:
      Number(
        row.review_amount ||
        0
      ),

    rulesRiskLevel,

    aiRiskLevel,

    riskLevel:
      row.risk_level ||
      "low",

    flags,

    createdAt:
      row.created_at

  };

}



// =============================================
// Create claim
// =============================================

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

        line_items,

        total_billed,

        risk_score,

        review_amount,

        rules_risk_level,

        ai_risk_level,

        risk_level,

        flags

      )

      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )

    `);


  const result =
    statement.run(

      claim.claimNumber,

      claim.providerName,

      claim.patientLabel,

      JSON.stringify(
        claim.diagnosisCodes ||
        []
      ),

      claim.clinicalNote,

      JSON.stringify(
        claim.lineItems ||
        []
      ),

      Number(
        analysis.totalBilled ||
        0
      ),

      Number(
        analysis.riskScore ||
        0
      ),

      Number(
        analysis.reviewAmount ||
        0
      ),

      analysis.rulesRiskLevel ||
        "low",

      analysis.aiRiskLevel ||
        "unavailable",

      analysis.riskLevel ||
        "low",

      JSON.stringify(
        analysis.flags ||
        []
      )

    );


  return getClaim(
    Number(
      result.lastInsertRowid
    )
  );

}



// =============================================
// Get one claim
// =============================================

export function getClaim(
  id
) {

  const row =
    db
      .prepare(
        `

          SELECT *
          FROM claims
          WHERE id = ?

        `
      )
      .get(id);


  return normalizeClaim(
    row
  );

}



// =============================================
// List claims
// =============================================

export function listClaims() {

  const rows =
    db
      .prepare(
        `

          SELECT *
          FROM claims
          ORDER BY id DESC

        `
      )
      .all();


  return rows.map(
    normalizeClaim
  );

}



// =============================================
// Dashboard stats
// =============================================

export function getDashboardStats() {

  const row =
    db
      .prepare(
        `

          SELECT

            COUNT(*) AS total_claims,

            SUM(
              CASE
                WHEN risk_level != 'low'
                THEN 1
                ELSE 0
              END
            ) AS flagged_claims,

            COALESCE(
              SUM(review_amount),
              0
            ) AS review_amount

          FROM claims

        `
      )
      .get();


  return {

    totalClaims:
      Number(
        row.total_claims ||
        0
      ),

    flaggedClaims:
      Number(
        row.flagged_claims ||
        0
      ),

    reviewAmount:
      Number(
        row.review_amount ||
        0
      )

  };

}



// =============================================
// Create Vapi call
// =============================================

export function createVapiCall(
  claimNumber,
  callId,
  status = "created"
) {

  db.prepare(`

    INSERT INTO vapi_calls (

      claim_number,

      vapi_call_id,

      status

    )

    VALUES (?, ?, ?)

    ON CONFLICT(vapi_call_id)

    DO UPDATE SET

      claim_number =
        excluded.claim_number,

      status =
        excluded.status,

      updated_at =
        CURRENT_TIMESTAMP

  `).run(

    claimNumber,

    callId,

    status

  );


  return getVapiCallByCallId(
    callId
  );

}



// =============================================
// Update Vapi status
// =============================================

export function updateVapiCallStatus(
  callId,
  status
) {

  db.prepare(`

    UPDATE vapi_calls

    SET
      status = ?,
      updated_at = CURRENT_TIMESTAMP

    WHERE vapi_call_id = ?

  `).run(

    status,

    callId

  );

}



// =============================================
// Complete Vapi call
// =============================================

export function completeVapiCall(
  callId,
  {
    status = "ended",
    endedReason = null,
    transcript = "",
    messages = [],
    startedAt = null,
    endedAt = null
  } = {}
) {

  db.prepare(`

    UPDATE vapi_calls

    SET

      status = ?,

      ended_reason = ?,

      transcript = ?,

      messages = ?,

      started_at = ?,

      ended_at = ?,

      updated_at =
        CURRENT_TIMESTAMP

    WHERE vapi_call_id = ?

  `).run(

    status,

    endedReason,

    transcript,

    JSON.stringify(
      messages ||
      []
    ),

    startedAt,

    endedAt,

    callId

  );


  return getVapiCallByCallId(
    callId
  );

}



// =============================================
// Normalize Vapi row
// =============================================

function normalizeVapiCall(
  row
) {

  if (
    !row
  ) {

    return null;

  }


  let messages =
    [];


  try {

    messages =
      JSON.parse(
        row.messages ||
        "[]"
      );

  } catch {

    messages =
      [];

  }


  return {

    id:
      row.id,

    claimNumber:
      row.claim_number,

    callId:
      row.vapi_call_id,

    status:
      row.status,

    endedReason:
      row.ended_reason,

    transcript:
      row.transcript,

    messages,

    startedAt:
      row.started_at,

    endedAt:
      row.ended_at,

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at

  };

}



// =============================================
// Get Vapi call by call ID
// =============================================

export function getVapiCallByCallId(
  callId
) {

  const row =
    db
      .prepare(
        `

          SELECT *
          FROM vapi_calls
          WHERE vapi_call_id = ?

        `
      )
      .get(
        callId
      );


  return normalizeVapiCall(
    row
  );

}



// =============================================
// Get Vapi calls for claim
// =============================================

export function getVapiCallsForClaim(
  claimNumber
) {

  const rows =
    db
      .prepare(
        `

          SELECT *
          FROM vapi_calls

          WHERE claim_number = ?

          ORDER BY id DESC

        `
      )
      .all(
        claimNumber
      );


  return rows.map(
    normalizeVapiCall
  );

}