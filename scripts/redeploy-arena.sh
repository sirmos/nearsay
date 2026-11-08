#!/usr/bin/env bash
# Replaces ONLY the Arena contract with the current code (a fresh, empty Arena).
# Use it when the Arena contract changed. The escrow, token and pass contracts are untouched.
# Needs: source scripts/testnet.env
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
: "${NS_ARENA:?Run: source scripts/testnet.env}"
CRED="$HOME/.near-credentials/testnet"
KINDS='["provider_tee"]'

echo "=== getting the arena contract"
if [ -n "${NS_WASM_DIR:-}" ]; then
  WASM="$(find "$NS_WASM_DIR" -name arena.wasm | head -1)"
else
  (cd contracts/arena && cargo near build non-reproducible-wasm) >&2 || { echo "build failed"; exit 1; }
  WASM=contracts/arena/target/near/arena.wasm
fi
[ -f "$WASM" ] || { echo "arena.wasm not found"; exit 1; }

echo "=== deleting the old arena account (its balance returns to the verifier)"
near account delete-account "$NS_ARENA" beneficiary "$NS_VERIFIER" network-config testnet sign-with-legacy-keychain send || echo "(delete skipped or failed)"

echo "=== recreating it"
rm -rf "$CRED/$NS_ARENA" "$CRED/$NS_ARENA.json"
if ! near account create-account sponsor-by-faucet-service "$NS_ARENA" autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain network-config testnet create >/dev/null 2>&1; then
  echo "faucet refused, funding from the verifier"
  rm -rf "$CRED/$NS_ARENA" "$CRED/$NS_ARENA.json"
  near account create-account fund-myself "$NS_ARENA" "3 NEAR" autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain \
    sign-as "$NS_VERIFIER" network-config testnet sign-with-legacy-keychain send || { echo "could not create $NS_ARENA"; exit 1; }
fi

echo "=== deploying"
near contract deploy "$NS_ARENA" use-file "$WASM" with-init-call new json-args \
  "{\"owner\":\"$NS_VERIFIER\",\"dealer\":\"$NS_VERIFIER\",\"accepted_kinds\":$KINDS,\"fee_bps\":100,\"liar_bps\":2000,\"max_guessers\":50,\"grace_ms\":3600000}" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send

echo "=== registering it on the test token"
near contract call-function as-transaction "$NS_CREDITS" register json-args "{\"account_id\":\"$NS_ARENA\"}" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as "$NS_VERIFIER" network-config testnet sign-with-legacy-keychain send

rm -f evidence/round-*.json .dealer/round-*.json
echo
echo "Done. The Arena is empty again. Old round evidence files were removed."
