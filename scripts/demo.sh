#!/usr/bin/env bash
# Plays Job Market, Arena and Guard on NEAR testnet. Evidence in these runs is "demo evidence".
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/testnet.env

next_id() {
  node -e '
const [acct, method, key] = process.argv.slice(1);
(async () => {
  for (let i = 1; i < 500; i++) {
    const r = await fetch("https://rpc.testnet.near.org", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final",
        account_id: acct, method_name: method, args_base64: Buffer.from(JSON.stringify({ [key]: i })).toString("base64") } }) });
    const j = await r.json();
    const v = j.result && j.result.result ? JSON.parse(Buffer.from(j.result.result).toString()) : null;
    if (v === null) { console.log(i); return; }
  }
})();' "$@"
}

JOB_ID="${1:-$(next_id "$NS_ESCROW" get_job job_id)}"
ROUND_ID="${2:-$(next_id "$NS_ARENA" get_round round_id)}"

echo "=== 1/3 Job Market: escrow, result, settlement (job $JOB_ID, demo evidence) ==="
bash scripts/e2e-cli.sh "$JOB_ID"

echo
echo "=== 2/3 Arena: commit, guess, reveal, claim (round $ROUND_ID, demo evidence) ==="
bash scripts/e2e-arena.sh "$ROUND_ID"

echo
echo "=== 3/3 Guard: red-team scoreboard (local, deterministic) ==="
(cd guard && node src/bench.mjs)

echo
echo "Done. Open the dashboard: python3 -m http.server 8080 -d web"
echo "Everything above used demo evidence. Attested evidence: see README, 'Real attestation'."
