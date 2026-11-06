#!/usr/bin/env bash
# One Arena round on testnet via the near CLI. Usage: scripts/e2e-arena.sh [ROUND_ID]
# ROUND_ID defaults to 1. Use 2, 3... for reruns. DEMO evidence: nothing here is attested.
set -u
source "$(dirname "$0")/testnet.env"
ROUND=${1:-1}
STAKE=1000000                       # 1 credit (6 decimals)
CLOSE_SECS=${CLOSE_SECS:-120}
CLOSE=$(( $(date +%s%3N) + CLOSE_SECS*1000 ))
SALT=salt
COMMIT=$(printf '1:%s' "$SALT" | sha256sum | cut -d' ' -f1)
NET="network-config testnet sign-with-legacy-keychain send"

call() { # contract method json signer gas deposit
  echo; echo "== $2 (as $4)"
  near contract call-function as-transaction "$1" "$2" json-args "$3" \
    prepaid-gas "$5" attached-deposit "$6" sign-as "$4" $NET 2>&1 \
    | grep -E "Function execution return value|Empty return value|Error|error|panicked|Smart contract|succeeded|failed" || true
}
view() {
  near contract call-function as-read-only "$1" "$2" json-args "$3" network-config testnet now 2>&1 \
    | grep -E '^"|^\{|^  "status"|^\[' | tr -d '\n'; echo
}
bal() { printf '%-10s ' "$1"; view $NS_CREDITS ft_balance_of "{\"account_id\":\"$2\"}"; }
snapshot() { echo; echo "-- balances ($1)"; bal buyer $NS_BUYER; bal seller $NS_SELLER; bal liar $NS_LIAR; bal verifier $NS_VERIFIER; }

snapshot before
call $NS_ARENA create_round "{\"question\":\"Name one real river in Africa.\",\"token\":\"$NS_CREDITS\",\"stake\":\"$STAKE\",\"answers\":[\"The Zambezi\",\"The Nile\",\"The Mombasa River\"],\"commit\":\"$COMMIT\",\"closes_ms\":$CLOSE}" $NS_VERIFIER '30 Tgas' '0 NEAR'
call $NS_CREDITS ft_transfer_call "{\"receiver_id\":\"$NS_ARENA\",\"amount\":\"$STAKE\",\"msg\":\"$ROUND:1\"}" $NS_BUYER '100 Tgas' '1 yoctoNEAR'
call $NS_CREDITS ft_transfer_call "{\"receiver_id\":\"$NS_ARENA\",\"amount\":\"$STAKE\",\"msg\":\"$ROUND:2\"}" $NS_SELLER '100 Tgas' '1 yoctoNEAR'

echo; echo "waiting for the guessing window to close..."
while [ $(( $(date +%s%3N) )) -lt $(( CLOSE + 8000 )) ]; do sleep 3; done

call $NS_ARENA reveal "{\"round_id\":$ROUND,\"real_index\":1,\"salt\":\"$SALT\",\"authors\":[null,null,\"$NS_LIAR\"],\"evidence\":{\"ok\":true,\"model_id\":\"demo\",\"signature_kind\":\"provider_tee\",\"signing_address\":\"0xdemo\",\"attestation_hash\":\"demo\",\"response_hash\":\"demo\"}}" $NS_VERIFIER '60 Tgas' '0 NEAR'
echo; echo "round status:"; view $NS_ARENA get_round "{\"round_id\":$ROUND}"

call $NS_ARENA claim "{\"token\":\"$NS_CREDITS\"}" $NS_BUYER    '100 Tgas' '0 NEAR'
call $NS_ARENA claim "{\"token\":\"$NS_CREDITS\"}" $NS_LIAR     '100 Tgas' '0 NEAR'
call $NS_ARENA claim "{\"token\":\"$NS_CREDITS\"}" $NS_VERIFIER '100 Tgas' '0 NEAR'
snapshot after
echo
echo "expected change: buyer +584000, seller -1000000, liar +396000, verifier +20000"
