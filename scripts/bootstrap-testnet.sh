#!/usr/bin/env bash
# Rebuilds the testnet deployment from scratch: accounts, contracts, token registrations, env file.
# Usage: bash scripts/bootstrap-testnet.sh        (optional: NS_PREFIX=name NS_ACCEPTED_KINDS='["provider_tee"]')
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
PREFIX="${NS_NEW_PREFIX:-sirmos-ns2}"
KINDS="${NS_ACCEPTED_KINDS:-[\"provider_tee\",\"gateway\"]}"
acct() { echo "${PREFIX}-$1.testnet"; }

echo "=== 1/5 creating accounts"
for n in credits escrow verifier buyer seller arena liar; do
  id="$(acct $n)"
  echo "-- $id"
  near account create-account sponsor-by-faucet-service "$id" autogenerate-new-keypair \
    --signature-scheme ed25519 save-to-legacy-keychain network-config testnet create \
    || echo "(skipped: $id may already exist)"
done

echo "=== 2/5 writing scripts/testnet.env"
cat > scripts/testnet.env <<ENV
export NS_PREFIX=$PREFIX
export NS_CREDITS=$(acct credits)
export NS_ESCROW=$(acct escrow)
export NS_VERIFIER=$(acct verifier)
export NS_BUYER=$(acct buyer)
export NS_SELLER=$(acct seller)
export NS_ARENA=$(acct arena)
export NS_LIAR=$(acct liar)
ENV

echo "=== 3/5 building contracts"
build() {
  (cd "contracts/$1" && cargo near build non-reproducible-wasm) >&2
  find "contracts/$1/target/near" -maxdepth 2 -name '*.wasm' | head -1
}
WASM_CREDITS="$(build credits)"; WASM_ESCROW="$(build escrow)"; WASM_ARENA="$(build arena)"
echo "built: $WASM_CREDITS $WASM_ESCROW $WASM_ARENA"

echo "=== 4/5 deploying contracts"
deploy() {
  near contract deploy "$1" use-file "$2" with-init-call new json-args "$3" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
}
V="$(acct verifier)"
deploy "$(acct credits)" "$WASM_CREDITS" '{}'
deploy "$(acct escrow)" "$WASM_ESCROW" "{\"owner\":\"$V\",\"verifier\":\"$V\",\"accepted_kinds\":$KINDS,\"fee_bps\":100,\"pair_cap\":\"100000000\"}"
deploy "$(acct arena)" "$WASM_ARENA" "{\"owner\":\"$V\",\"dealer\":\"$V\",\"accepted_kinds\":$KINDS,\"fee_bps\":100,\"liar_bps\":2000,\"max_guessers\":50,\"grace_ms\":3600000}"

echo "=== 5/5 registering accounts on the test token"
for n in escrow arena seller buyer verifier liar; do
  near contract call-function as-transaction "$(acct credits)" register json-args "{\"account_id\":\"$(acct $n)\"}" \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as "$(acct buyer)" network-config testnet sign-with-legacy-keychain send
done

# Point the dashboard and README at the new contracts.
sed -i "s/sirmos-ns-/${PREFIX}-/g" web/index.html README.md || true
echo
echo "Done. Next:  source scripts/testnet.env && bash scripts/demo.sh"
echo "Then commit the new env file, dashboard and README (plain commit)."
