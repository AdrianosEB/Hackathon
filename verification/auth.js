// --------------------------------------------------
// OUTREACH AUTHENTICATION
//
// The outreach endpoints were open. Anyone who could
// reach the server could approve a call and type any
// name they liked into `approvedBy`.
//
// That matters more here than it would on most
// endpoints. The whole design rests on one claim: no
// phone rings without a named human deciding it
// should. An unauthenticated approve route means the
// name in the audit trail is whatever the caller typed
// — so the audit trail records an assertion by an
// anonymous party, which is not an audit trail. And
// with an adapter wired, the thing on the other side
// of that route is a telephone.
//
// Minimal, deliberately: a shared secret per operator.
// Not a session system, not SSO. The property that
// matters is that `approvedBy` stops being caller-
// supplied — the operator's name is derived from the
// token they authenticated with, so an approver cannot
// sign someone else's name to a call.
//
//   OUTREACH_OPERATORS="tok_alice:Alice Chen,tok_raj:Raj Patel"
//
// Falls back to a single shared secret if that is all
// you have:
//
//   OUTREACH_SHARED_SECRET=... plus a body approvedBy
//
// Credentials arrive in the x-outreach-token header,
// never a query string.
// --------------------------------------------------


function parseOperators() {

  const raw = String(process.env.OUTREACH_OPERATORS || "").trim();

  if (!raw) {
    return null;
  }

  const operators = new Map();

  for (const entry of raw.split(",")) {

    const [token, ...nameParts] = entry.split(":");

    const cleanToken = String(token || "").trim();
    const name = nameParts.join(":").trim();

    if (cleanToken && name) {
      operators.set(cleanToken, name);
    }

  }

  return operators.size > 0 ? operators : null;

}


// Constant-time-ish compare. Token lengths here are
// not secret, but short-circuiting on the first
// differing byte is a habit worth not forming.
function safeEqual(a, b) {

  const x = String(a);
  const y = String(b);

  if (x.length !== y.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < x.length; i++) {
    diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  }

  return diff === 0;

}


export function authenticateOutreach(req) {

  const presented = String(req.get?.("x-outreach-token") || "").trim();

  const operators = parseOperators();

  if (operators) {

    for (const [token, name] of operators) {
      if (safeEqual(presented, token)) {
        return { ok: true, operator: name, identified: true };
      }
    }

    return { ok: false, reason: "Unrecognised outreach token." };

  }

  const shared = String(process.env.OUTREACH_SHARED_SECRET || "").trim();

  if (!shared) {

    return {
      ok: false,
      reason:
        "Outreach endpoints are unconfigured. Set OUTREACH_OPERATORS (preferred — it " +
        "binds approvals to a named person) or OUTREACH_SHARED_SECRET before using them. " +
        "These routes approve and place telephone calls; they do not run open."
    };

  }

  if (!safeEqual(presented, shared)) {
    return { ok: false, reason: "Invalid outreach token." };
  }

  // Shared-secret mode cannot attribute the approval on
  // its own, so the caller still supplies a name — and
  // the audit trail records that it was only
  // shared-secret authenticated.
  return { ok: true, operator: null, identified: false };

}


export function requireOutreachAuth(req, res, next) {

  const result = authenticateOutreach(req);

  if (!result.ok) {
    return res.status(401).json({ error: result.reason });
  }

  req.outreachOperator = result.operator;
  req.outreachIdentified = result.identified;

  next();

}


// Who is approving this, and can we prove it?
//
// With OUTREACH_OPERATORS the name comes from the
// token and the body cannot override it. That is the
// point of the whole file.
export function resolveApprover(req) {

  if (req.outreachIdentified) {
    return { approvedBy: req.outreachOperator, attributed: "token" };
  }

  const claimed = String(req.body?.approvedBy || "").trim();

  if (!claimed) {
    return { approvedBy: null, attributed: null };
  }

  return {
    approvedBy: `${claimed} (shared secret; name not verified)`,
    attributed: "self-declared"
  };

}
