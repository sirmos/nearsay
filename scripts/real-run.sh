#!/usr/bin/env bash
# One real, hardware-attested run on testnet: a paid job and Arena rounds.
# Needs: source scripts/testnet.env   and   NEARAI_API_KEY in this shell (never in a file).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${NEARAI_API_KEY:?Set NEARAI_API_KEY in this shell first}"
: "${NS_ESCROW:?Run: source scripts/testnet.env}"
PROMPT="${1:-Write one honest sentence a delivery agent could send when a parcel is late.}"

echo "=== Job: escrow, attested work, verification, settlement"
JOB=$(node services/buyer.mjs "$PROMPT" 5 | sed -n 's/^creating job \([0-9]*\):.*/\1/p')
node services/seller.mjs "$JOB" "$PROMPT"
node services/verifier.mjs --job "$JOB"

echo "=== Arena: three rounds, one per difficulty tier (answers revealed after they close)"
for t in 1 2 3; do node services/dealer.mjs open-live --tier "$t" --minutes 10; done
echo
echo "Play them on the dashboard. After 10 minutes run:"
echo "  node services/dealer.mjs reveal-all"
echo "Then commit and push evidence/ so the dashboard can link it."
