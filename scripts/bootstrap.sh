#!/usr/bin/env bash
# Builds a fresh testnet deployment: accounts, contracts, token registrations, env file, dashboard wiring.
# Usage:  bash scripts/bootstrap.sh
# Options (env): NS_NEW_PREFIX=nearsay   NS_FUND_FROM=<account that pays if the faucet refuses>
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
PREFIX="${NS_NEW_PREFIX:-nearsay}"
FUND_FROM="${NS_FUND_FROM:-sirmos-ns2-verifier.testnet}"
KINDS='["provider_tee"]'
CRED="$HOME/.near-credentials/testnet"
acct() { echo "${PREFIX}-$1.testnet"; }
exists() { near account view-account-summary "$1" network-config testnet now >/dev/null 2>&1; }

ensure_account() {
  local id="$1" amt="$2"
  if exists "$id"; then echo "ok: $id exists"; return; fi
  rm -rf "$CRED/$id" "$CRED/$id.json"   # stale keys would block saving the real key
  if near account create-account sponsor-by-faucet-service "$id" autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain network-config testnet create >/dev/null 2>&1; then
    echo "created via faucet: $id"; return
  fi
  echo "faucet refused for $id, funding it from $FUND_FROM ($amt)"
  rm -rf "$CRED/$id" "$CRED/$id.json"
  near account create-account fund-myself "$id" "$amt" autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain \
    sign-as "$FUND_FROM" network-config testnet sign-with-legacy-keychain send || echo "!! could not create $id"
}

echo "=== 1/5 accounts (prefix: $PREFIX)"
ensure_account "$(acct verifier)" "6 NEAR"
for n in credits escrow arena pass; do ensure_account "$(acct $n)" "3 NEAR"; done
for n in buyer seller liar; do ensure_account "$(acct $n)" "1 NEAR"; done

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
export NS_PASS=$(acct pass)
ENV

echo "=== 3/5 building contracts (a few minutes, or instant with NS_WASM_DIR)"
build() {
  # NS_WASM_DIR = a folder of contracts built elsewhere (for example by the GitHub workflow). No Rust needed.
  if [ -n "${NS_WASM_DIR:-}" ]; then find "$NS_WASM_DIR" -name "$1.wasm" | head -1; return; fi
  (cd "contracts/$1" && cargo near build non-reproducible-wasm) >&2 && find "contracts/$1/target/near" -maxdepth 2 -name '*.wasm' | head -1
}
W_CREDITS="$(build credits)"; W_ESCROW="$(build escrow)"; W_ARENA="$(build arena)"; W_PASS="$(build pass)"
echo "built: $W_CREDITS $W_ESCROW $W_ARENA $W_PASS"

echo "=== 4/5 deploying contracts"
deploy() {
  near contract deploy "$1" use-file "$2" with-init-call new json-args "$3" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
}
V="$(acct verifier)"
deploy "$(acct credits)" "$W_CREDITS" '{}'
deploy "$(acct escrow)" "$W_ESCROW" "{\"owner\":\"$V\",\"verifier\":\"$V\",\"accepted_kinds\":$KINDS,\"fee_bps\":100,\"pair_cap\":\"100000000\"}"
deploy "$(acct arena)" "$W_ARENA" "{\"owner\":\"$V\",\"dealer\":\"$V\",\"accepted_kinds\":$KINDS,\"fee_bps\":100,\"liar_bps\":2000,\"max_guessers\":50,\"grace_ms\":3600000}"
# Season pass: 0.1 NEAR for 7 days.
deploy "$(acct pass)" "$W_PASS" "{\"owner\":\"$V\",\"price\":\"100000000000000000000000\",\"season_ms\":604800000}"

echo "=== 5/5 registering accounts on the test token"
for n in escrow arena seller buyer verifier liar; do
  near contract call-function as-transaction "$(acct credits)" register json-args "{\"account_id\":\"$(acct $n)\"}" \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as "$V" network-config testnet sign-with-legacy-keychain send || echo "(register $n failed)"
done

# Point the dashboard at the new contracts.
sed -i "s/const NS_PREFIX = \"[^\"]*\"/const NS_PREFIX = \"$PREFIX\"/" web/config.js
echo
echo "Done. Next: source scripts/testnet.env && NEARAI_API_KEY=... bash scripts/real-run.sh"
