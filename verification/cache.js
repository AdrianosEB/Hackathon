// --------------------------------------------------
// PROVIDER VERIFICATION CACHE
//
// Provider identity is stable for months. Registry
// status changes rarely; a practice does not stop
// existing between two claims submitted an hour
// apart. Re-running the whole agent panel per claim
// would be slow, expensive, and — during a live demo
// on conference wifi — the thing that breaks.
//
// So: verify a provider once, key by NPI, reuse until
// the entry ages out.
//
// The one rule that matters: NEVER cache a failed or
// unknown result for long. A cached outage is a lie
// that persists. Unmatched results also get a shorter
// life than clean ones, so a provider who fixes their
// registration is re-checked sooner.
// --------------------------------------------------

import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("claim-integrity.db");


// --------------------------------------------------
// Time-to-live, by outcome
// --------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

const TTL_MS = {

  // A confirmed, active provider stays confirmed.
  confirmed: 30 * DAY,

  probable: 14 * DAY,

  // Unmatched results expire faster: a provider may
  // have corrected a registration, and we should not
  // hold a stale mismatch against them.
  incomplete: 3 * DAY,

  conflicting: 3 * DAY,

  // A result we could not compute is worth almost
  // nothing. Just enough to absorb a burst of claims
  // from one provider during a registry outage.
  unknown: 15 * 60 * 1000

};


db.exec(`

  CREATE TABLE IF NOT EXISTS provider_verifications (

    npi TEXT PRIMARY KEY,

    provider_name TEXT,

    data_confidence_score INTEGER,

    confidence_band TEXT NOT NULL,

    blocking INTEGER NOT NULL DEFAULT 0,

    blocking_reason TEXT,

    rationale TEXT,

    checks TEXT NOT NULL,

    coverage TEXT NOT NULL,

    -- Which sources were live when this was computed.
    -- If you enable a new verifier, entries computed
    -- under the old configuration are stale even if
    -- they haven't expired.
    source_fingerprint TEXT NOT NULL,

    duration_ms INTEGER,

    verified_at TEXT NOT NULL,

    expires_at TEXT NOT NULL

  );

`);


db.exec(`
  CREATE INDEX IF NOT EXISTS idx_provider_expiry
  ON provider_verifications (expires_at);
`);


// --------------------------------------------------
// Extend the claims table
//
// SQLite has no "ADD COLUMN IF NOT EXISTS", so check
// the schema first. Safe to run on every boot.
// --------------------------------------------------

const NEW_CLAIM_COLUMNS = [
  ["npi", "TEXT"],
  ["practice_address_line1", "TEXT"],
  ["practice_city", "TEXT"],
  ["practice_state", "TEXT"],
  ["practice_phone", "TEXT"],
  ["data_confidence_score", "INTEGER"],
  ["confidence_band", "TEXT"],
  ["verification", "TEXT"]
];


export function migrateClaimsTable() {

  // db.js creates the claims table as an import side
  // effect. Depending on that having happened first is
  // an import-order trap, so check rather than assume —
  // PRAGMA on a missing table returns an empty list and
  // the ALTERs below would then fail with a confusing
  // "no such table".
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='claims'")
    .get();

  if (!tableExists) {
    return { migrated: false, reason: "claims table does not exist yet" };
  }

  const existing = new Set(
    db
      .prepare("PRAGMA table_info(claims)")
      .all()
      .map((column) => column.name)
  );

  for (const [name, type] of NEW_CLAIM_COLUMNS) {

    if (!existing.has(name)) {

      db.exec(`ALTER TABLE claims ADD COLUMN ${name} ${type};`);

    }

  }

}


// --------------------------------------------------
// Fingerprint the active source configuration
// --------------------------------------------------

export function sourceFingerprint(coverage) {

  return [...coverage.checked].sort().join(",") || "none";

}


// --------------------------------------------------
// Read
// --------------------------------------------------

export function getCachedVerification(npi, currentFingerprint) {

  if (!npi) {
    return null;
  }

  const row = db
    .prepare("SELECT * FROM provider_verifications WHERE npi = ?")
    .get(String(npi).trim());

  if (!row) {
    return null;
  }

  // A cache entry computed with fewer sources than we
  // run today is not a valid answer to today's
  // question — it is a narrower one.
  if (row.source_fingerprint !== currentFingerprint) {
    return null;
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }

  return {
    npi: row.npi,
    dataConfidenceScore: row.data_confidence_score,
    confidenceBand: row.confidence_band,
    blocking: Boolean(row.blocking),
    blockingReason: row.blocking_reason,
    rationale: row.rationale,
    checks: safeParse(row.checks, []),
    coverage: safeParse(row.coverage, {}),
    durationMs: row.duration_ms,
    verifiedAt: row.verified_at,
    fromCache: true
  };

}


// --------------------------------------------------
// Write
// --------------------------------------------------

export function cacheVerification(npi, providerName, result) {

  // Without an NPI there is no stable key. Name-based
  // caching would collide across the many real
  // practices that share a name — exactly the
  // confusion this system exists to prevent.
  if (!npi) {
    return;
  }

  const ttl =
    result.dataConfidenceScore === null
      ? TTL_MS.unknown
      : TTL_MS[result.confidenceBand] ?? TTL_MS.incomplete;

  const now = Date.now();

  db.prepare(`

    INSERT INTO provider_verifications (
      npi, provider_name, data_confidence_score, confidence_band,
      blocking, blocking_reason, rationale, checks, coverage,
      source_fingerprint, duration_ms, verified_at, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    ON CONFLICT(npi) DO UPDATE SET
      provider_name      = excluded.provider_name,
      data_confidence_score  = excluded.data_confidence_score,
      confidence_band   = excluded.confidence_band,
      blocking             = excluded.blocking,
      blocking_reason        = excluded.blocking_reason,
      rationale          = excluded.rationale,
      checks             = excluded.checks,
      coverage           = excluded.coverage,
      source_fingerprint = excluded.source_fingerprint,
      duration_ms        = excluded.duration_ms,
      verified_at        = excluded.verified_at,
      expires_at         = excluded.expires_at

  `).run(

    String(npi).trim(),
    providerName || null,
    result.dataConfidenceScore,
    result.confidenceBand,
    result.blocking ? 1 : 0,
    result.blockingReason || null,
    result.rationale || null,
    JSON.stringify(result.checks || []),
    JSON.stringify(result.coverage || {}),
    sourceFingerprint(result.coverage || { checked: [] }),
    result.durationMs || null,
    result.verifiedAt || new Date(now).toISOString(),
    new Date(now + ttl).toISOString()

  );

}


// --------------------------------------------------
// Address clustering
//
// Not a source — a query over what we already have.
// Ghost networks register many shell NPIs at one
// suite, so counting distinct NPIs per address is
// free signal that gets stronger as the database
// fills. Feeds the history verifier when you enable it.
// --------------------------------------------------

export function providersAtAddress(addressLine1, state) {

  if (!addressLine1) {
    return [];
  }

  return db
    .prepare(`
      SELECT DISTINCT npi, provider_name
      FROM claims
      WHERE practice_address_line1 = ?
        AND (? IS NULL OR practice_state = ?)
        AND npi IS NOT NULL
    `)
    .all(
      String(addressLine1).trim(),
      state || null,
      state || null
    );

}


function safeParse(value, fallback) {

  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }

}
