#!/usr/bin/env bash
# One full escrow job on testnet using only the near CLI. Usage: scripts/e2e-cli.sh [JOB_ID]
# JOB_ID defaults to 1 (first job). Use 2, 3... for reruns.
set -u
source "$(dirname "$0")/testnet.env"
JOB=${1:-1}
AMOUNT=10000000                # 10 credits (6 decimals)
DEADLINE=$(( $(date +%s%3N) + 3600000 ))   # now + 1 hour, in ms
NET="network-config testnet sign-with-legacy-keychain send"

call() { # contract method json signer gas deposit
  echo; echo "== $2 (as $4)"
  near contract call-function as-transaction "$1" "$2" json-args "$3" \
    prepaid-gas "$5" attached-deposit "$6" sign-as "$4" $NET 2>&1 \
    | grep -E "Function execution return value|Empty return value|Logs \[|Error|error|panicked|Smart contract|succeeded|failed" || true
}
view() {
  echo; echo "== view $2"
  near contract call-function as-read-only "$1" "$2" json-args "$3" network-config testnet now 2>&1 \
    | grep -vE "^\s*$|console command|near contract call-function" || true
}

call $NS_CREDITS register   "{\"account_id\":\"$NS_ESCROW\"}" $NS_ESCROW '30 Tgas' '0 NEAR'
call $NS_CREDITS register   "{\"account_id\":\"$NS_SELLER\"}" $NS_SELLER '30 Tgas' '0 NEAR'
call $NS_CREDITS faucet     "{\"amount\":\"100000000\"}"       $NS_BUYER  '30 Tgas' '0 NEAR'
call $NS_ESCROW  create_job "{\"seller\":\"$NS_SELLER\",\"token\":\"$NS_CREDITS\",\"amount\":\"$AMOUNT\",\"spec_hash\":\"spec-demo\",\"deadline_ms\":$DEADLINE}" $NS_BUYER '30 Tgas' '0 NEAR'
call $NS_CREDITS ft_transfer_call "{\"receiver_id\":\"$NS_ESCROW\",\"amount\":\"$AMOUNT\",\"msg\":\"$JOB\"}" $NS_BUYER '100 Tgas' '1 yoctoNEAR'
view $NS_ESCROW get_job "{\"job_id\":$JOB}"
call $NS_ESCROW  submit_result "{\"job_id\":$JOB,\"result_hash\":\"hash1\",\"evidence_ref\":\"demo\"}" $NS_SELLER '30 Tgas' '0 NEAR'
call $NS_ESCROW  settle "{\"job_id\":$JOB,\"verdict\":{\"job_id\":$JOB,\"result_hash\":\"hash1\",\"ok\":true,\"model_id\":\"demo\",\"signature_kind\":\"provider_tee\",\"signing_address\":\"0xdemo\",\"attestation_hash\":\"demo\"}}" $NS_VERIFIER '100 Tgas' '0 NEAR'

view $NS_ESCROW  get_job "{\"job_id\":$JOB}"
view $NS_ESCROW  get_reputation "{\"account_id\":\"$NS_SELLER\"}"
view $NS_CREDITS ft_balance_of "{\"account_id\":\"$NS_SELLER\"}"
view $NS_CREDITS ft_balance_of "{\"account_id\":\"$NS_ESCROW\"}"
view $NS_CREDITS ft_balance_of "{\"account_id\":\"$NS_BUYER\"}"
