#!/usr/bin/env bash
# Finishes a partly completed bootstrap: missing accounts, arena deploy, token registrations, dashboard names.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
source scripts/testnet.env
echo "using prefix: $NS_PREFIX"
CRED="$HOME/.near-credentials/testnet"

exists() { near account view-account-summary "$1" network-config testnet now >/dev/null 2>&1; }

ensure_account() {
  local id="$1" amt="$2" out
  if exists "$id"; then echo "ok: $id exists"; return; fi
  rm -rf "$CRED/$id" "$CRED/$id.json"   # stale keys from failed attempts would block saving the real key
  if out=$(near account create-account sponsor-by-faucet-service "$id" autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain network-config testnet create 2>&1); then
    echo "created via faucet: $id"; return
  fi
  echo "faucet refused for $id, funding it from the verifier ($amt)"
  rm -rf "$CRED/$id" "$CRED/$id.json"
  near account create-account fund-myself "$id" "$amt" autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain \
    sign-as "$NS_VERIFIER" network-config testnet sign-with-legacy-keychain send \
    || echo "!! could not create $id"
}

echo "=== accounts"
ensure_account "$NS_ARENA" "3 NEAR"
ensure_account "$NS_BUYER" "1 NEAR"
ensure_account "$NS_SELLER" "1 NEAR"
ensure_account "$NS_LIAR" "1 NEAR"

echo "=== arena contract"
if near contract call-function as-read-only "$NS_ARENA" get_dealer json-args '{}' network-config testnet now >/dev/null 2>&1; then
  echo "arena already deployed"
else
  near contract deploy "$NS_ARENA" use-file contracts/arena/target/near/arena.wasm with-init-call new json-args \
    "{\"owner\":\"$NS_VERIFIER\",\"dealer\":\"$NS_VERIFIER\",\"accepted_kinds\":[\"provider_tee\",\"gateway\"],\"fee_bps\":100,\"liar_bps\":2000,\"max_guessers\":50,\"grace_ms\":3600000}" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
fi

echo "=== registering accounts on the test token"
for a in "$NS_ARENA" "$NS_SELLER" "$NS_BUYER" "$NS_VERIFIER" "$NS_LIAR"; do
  near contract call-function as-transaction "$NS_CREDITS" register json-args "{\"account_id\":\"$a\"}" \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as "$NS_VERIFIER" network-config testnet sign-with-legacy-keychain send \
    || echo "(register $a skipped or failed)"
done

sed -i "s/sirmos-ns-/${NS_PREFIX}-/g" web/index.html README.md || true
echo
echo "Done. Next:  source scripts/testnet.env && bash scripts/demo.sh"
