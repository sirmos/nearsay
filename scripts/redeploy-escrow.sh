#!/usr/bin/env bash
# Puts the current escrow contract on the escrow account. Use it when the escrow code changed.
# Needs: source scripts/testnet.env   and   NS_WASM_DIR=<folder with escrow.wasm>   (or Rust installed)
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
: "${NS_ESCROW:?Run: source scripts/testnet.env}"
if [ -n "${NS_WASM_DIR:-}" ]; then WASM="$(find "$NS_WASM_DIR" -name escrow.wasm | head -1)"
else (cd contracts/escrow && cargo near build non-reproducible-wasm) >&2 || { echo "build failed"; exit 1; }; WASM=contracts/escrow/target/near/escrow.wasm; fi
[ -f "$WASM" ] || { echo "escrow.wasm not found"; exit 1; }
JOBS=$(node -e 'import("./services/lib.mjs").then(async m=>{console.log(await m.view(process.env.NS_ESCROW,"get_job",{job_id:1})?1:0)})')
if [ "$JOBS" = "0" ]; then
  echo "=== no jobs exist yet, deploying the new code over the old"
  near contract deploy "$NS_ESCROW" use-file "$WASM" without-init-call network-config testnet sign-with-legacy-keychain send
else
  echo "Jobs already exist and the stored layout changed. Create a new deployment instead: NS_NEW_PREFIX=nearsay3 bash scripts/bootstrap.sh"
  exit 1
fi
