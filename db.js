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
// Legacy Vapi transcript table
// =============================================

db.exec(`
  CREATE TABLE IF NOT EXISTS vapi_call_transcripts (

    call_id TEXT PRIMARY KEY,

    claim_number TEXT,

    transcript TEXT,
    messages TEXT,
    ended_reason TEXT,

    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

  );
`);


// =============================================
// Migration helper
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
// Hybrid risk columns
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
// Safe JSON parser
// =============================================

function parseJson(
  value,
  fallback
) {

  try {

    return value
      ? JSON.parse(
          value
        )
      : fallback;

  } catch {

    return fallback;

  }

}


// =============================================
// Risk helper
// =============================================

function deriveRiskLevel(
  flags
) {

  if (
    !Array.isArray(
      flags
    )
  ) {

    return "low";

  }


  if (
    flags.some(
      (flag) =>
        flag.severity ===
        "high"
    )
  ) {

    return "high";

  }


  if (
    flags.some(
      (flag) =>
        flag.severity ===
        "medium"
    )
  ) {

    return "review";

  }


  return "low";

}


// =============================================
// Derive rules rating for old claims
// =============================================

function deriveRulesRiskLevel(
  flags
) {

  const ruleFlags =

    Array.isArray(
      flags
    )

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
// Derive AI rating for old claims
// =============================================

function deriveAiRiskLevel(
  flags
) {

  const aiSeverities =
    [];


  if (
    !Array.isArray(
      flags
    )
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
// Normalize claim
// =============================================

function normalizeClaim(
  row
) {

  if (
    !row
  ) {

    return null;

  }


  const diagnosisCodes =
    parseJson(
      row.diagnosis_codes,
      []
    );


  const lineItems =
    parseJson(
      row.line_items,
      []
    );


  const flags =
    parseJson(
      row.flags,
      []
    );


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
      .prepare(`
        SELECT *
        FROM claims
        WHERE id = ?
      `)
      .get(
        id
      );


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
      .prepare(`
        SELECT *
        FROM claims
        ORDER BY id DESC
      `)
      .all();


  return rows.map(
    normalizeClaim
  );

}


// =============================================
// Dashboard statistics
// =============================================

export function getDashboardStats() {

  const row =
    db
      .prepare(`
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
      `)
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
// Provider analytics
//
// IMPORTANT:
// Counts UNIQUE bills using claim_number.
//
// If the same claim_number appears multiple times,
// only the newest database row is counted.
// =============================================

export function getProviderRiskStats() {

  const rows =
    db
      .prepare(`
        WITH latest_unique_claims AS (

          SELECT
            c.id,
            c.claim_number,
            c.provider_name,
            c.risk_level

          FROM claims c

          INNER JOIN (

            SELECT

              claim_number,

              MAX(id) AS latest_id

            FROM claims

            GROUP BY claim_number

          ) latest

          ON c.id = latest.latest_id

        )

        SELECT

          provider_name,

          COUNT(*) AS total_claims,

          SUM(
            CASE

              WHEN risk_level = 'low'
              THEN 1

              ELSE 0

            END
          ) AS low_claims,

          SUM(
            CASE

              WHEN risk_level = 'review'
              THEN 1

              ELSE 0

            END
          ) AS review_claims,

          SUM(
            CASE

              WHEN risk_level = 'high'
              THEN 1

              ELSE 0

            END
          ) AS high_claims

        FROM latest_unique_claims

        GROUP BY provider_name

        ORDER BY

          total_claims DESC,

          provider_name ASC
      `)
      .all();


  return rows.map(
    (row) => {

      const totalClaims =
        Number(
          row.total_claims ||
          0
        );


      const lowClaims =
        Number(
          row.low_claims ||
          0
        );


      const reviewClaims =
        Number(
          row.review_claims ||
          0
        );


      const highClaims =
        Number(
          row.high_claims ||
          0
        );


      const flaggedClaims =
        reviewClaims +
        highClaims;


      const lowPercent =

        totalClaims > 0

          ? (
              lowClaims /
              totalClaims
            ) * 100

          : 0;


      const reviewPercent =

        totalClaims > 0

          ? (
              reviewClaims /
              totalClaims
            ) * 100

          : 0;


      const highPercent =

        totalClaims > 0

          ? (
              highClaims /
              totalClaims
            ) * 100

          : 0;


      const flaggedPercent =

        totalClaims > 0

          ? (
              flaggedClaims /
              totalClaims
            ) * 100

          : 0;


      return {

        providerName:
          row.provider_name,

        totalClaims,

        lowClaims,

        reviewClaims,

        highClaims,

        flaggedClaims,

        lowPercent,

        reviewPercent,

        highPercent,

        flaggedPercent

      };

    }
  );

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

      updated_at =
        CURRENT_TIMESTAMP

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
// Normalize Vapi call
// =============================================

function normalizeVapiCall(
  row
) {

  if (
    !row
  ) {

    return null;

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

    messages:
      parseJson(
        row.messages,
        []
      ),

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
      .prepare(`
        SELECT *

        FROM vapi_calls

        WHERE vapi_call_id = ?
      `)
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
      .prepare(`
        SELECT *

        FROM vapi_calls

        WHERE claim_number = ?

        ORDER BY id DESC
      `)
      .all(
        claimNumber
      );


  return rows.map(
    normalizeVapiCall
  );

}


// =============================================
// Legacy transcript helper
// =============================================

export function saveVapiCallTranscript({
  callId,
  claimNumber,
  transcript,
  messages,
  endedReason
}) {

  db
    .prepare(`
      INSERT INTO vapi_call_transcripts (

        call_id,
        claim_number,
        transcript,
        messages,
        ended_reason

      )

      VALUES (?, ?, ?, ?, ?)

      ON CONFLICT(call_id)

      DO UPDATE SET

        claim_number =
          excluded.claim_number,

        transcript =
          excluded.transcript,

        messages =
          excluded.messages,

        ended_reason =
          excluded.ended_reason,

        received_at =
          CURRENT_TIMESTAMP
    `)
    .run(

      callId,

      claimNumber ||
        null,

      transcript ||
        null,

      JSON.stringify(
        messages ||
        []
      ),

      endedReason ||
        null

    );


  return getVapiCallTranscript(
    callId
  );

}


// =============================================
// Legacy transcript lookup
// =============================================

export function getVapiCallTranscript(
  callId
) {

  const row =
    db
      .prepare(`
        SELECT *

        FROM vapi_call_transcripts

        WHERE call_id = ?
      `)
      .get(
        callId
      );


  if (
    !row
  ) {

    return null;

  }


  return {

    callId:
      row.call_id,

    claimNumber:
      row.claim_number,

    transcript:
      row.transcript,

    messages:
      parseJson(
        row.messages,
        []
      ),

    endedReason:
      row.ended_reason,

    receivedAt:
      row.received_at

  };

}