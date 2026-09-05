#!/usr/bin/env bash
#
# Start everything needed to see the system work,
# entirely offline.
#
#   ./run-local.sh          then open http://localhost:3000
#
# Three processes:
#   :3101  fixture federal registry (NPPES-shaped)
#   :3102  fixture practice websites
#   :3000  the app
#
# No real registry is contacted, and every fixture NPI
# starts with 9 — a range CMS has never assigned — so
# no real provider can be implicated.

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

cleanup() {
  echo ""
  echo "Stopping..."
  kill ${PIDS[@]:-} 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

PIDS=()

node fixtures/nppes-fixture-server.js & PIDS+=($!)
node fixtures/website-server.js       & PIDS+=($!)

sleep 1.5

# Outreach endpoints refuse every request until an
# operator is configured. Named tokens rather than one
# shared secret, so an approval is attributable to a
# person — the approver's name comes from the token,
# not from the request body.
export OUTREACH_OPERATORS="${OUTREACH_OPERATORS:-tok_alice:Alice Chen,tok_raj:Raj Patel}"

# Point the registry at the local fixture, and allow
# the website tier to reach localhost. Both are opt-in
# by env var, never inferred from a URL.
export NPPES_BASE_URL="${NPPES_BASE_URL:-http://localhost:3101/api/}"
export ALLOW_LOCAL_WEBSITES="${ALLOW_LOCAL_WEBSITES:-true}"

# Dispatch stays a dry run: VAPI_ADAPTER is not set, so
# dispatch() shows the payload it would have sent and
# places no call. Arming it takes TWO switches —
# VAPI_ADAPTER=true and DEMO_AUTO_CALL=true — and even
# then it rings DEMO_BILLING_CONTACT, not a practice.
export DEMO_BILLING_CONTACT="${DEMO_BILLING_CONTACT:-+15555550123}"
export VAPI_TARGET_MODE="${VAPI_TARGET_MODE:-demo}"

echo ""
echo "  Registry fixture   http://localhost:3101"
echo "  Practice websites  http://localhost:3102"
echo "  App                http://localhost:3000"
echo ""
echo "  Operator token for the outreach queue: tok_alice"
echo ""

node server.js & PIDS+=($!)

wait
