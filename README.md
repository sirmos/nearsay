# Nearsay

Agents get paid only for provable work.

A buyer's money waits in escrow on NEAR. The seller agent runs the job on NEAR AI Cloud and submits the
result hash plus an evidence bundle. A verifier re-checks the hardware attestation (Intel TDX and NVIDIA GPU)
and the signature over the exact response bytes. Only a result that checks out releases the payment.
Every settled job feeds a reputation ledger, so an agent's record comes only from paid, verified work.

Built for the NEAR Hackathon with AI assistance (Claude Code). Runs on NEAR testnet with a free test token (NSC).

Live dashboard: https://sirmos.github.io/nearsay/ (read-only, reads straight from testnet)

## What runs, and how to check it

| Part | What it does | Check it yourself |
|---|---|---|
| Escrow contract | Holds the buyer's tokens. Pays the seller only on an accepted verdict, otherwise refunds. | Step 1, 4 |
| Reputation ledger | Built only from settled escrows, with a per-pair cap against friends inflating each other. | Step 1 |
| Verifier | Checks Intel TDX quotes, RTMR3 replay, NVIDIA GPU evidence and the response signature. | Step 2 |
| Guard | Spending-limit checks on signed mandates. 24 of 24 attacks blocked, 7 of 7 legitimate payments allowed. | Step 3 |
| Arena contract | Players stake on which answer the model really produced. The real position is committed before guessing. | Step 4 |

## Try it: do X, see Y

**1. Contract tests**

    cd contracts/escrow && cargo test --lib
    cd ../arena && cargo test --lib
    cd ../credits && cargo test --lib

See all tests pass (escrow 7, arena 11, credits 2).

**2. Verify a real hardware attestation**

    cd verifier && npm install && npm test
    node src/cli.mjs ../fixtures/attestation-sample.json --gpu

See `VERIFIED` for the gateway and the model, and GPU evidence `PASS`.
`--offline` skips the Intel and NVIDIA network checks. An offline run is never reported as verified.

**3. Guard scoreboard**

    cd guard && npm install && npm test
    node src/bench.mjs

See 24/24 attacks blocked, 7/7 legitimate payments allowed, then a list of what Guard does not stop.

**4. Escrow and Arena on testnet**

    source scripts/testnet.env
    bash scripts/demo.sh

See a job settle (seller paid minus a 1% fee) and an Arena round pay out, then open the dashboard.
These runs use hand-written test verdicts. They prove the money logic and they are labeled as test verdicts
on the dashboard. They are not attested results.

**5. Run a real attested job (needs a NEAR AI Cloud key with credits)**

    source scripts/testnet.env
    node services/buyer.mjs "Name one river in Africa." 5
    NEARAI_API_KEY=... node services/seller.mjs <jobId> "Name one river in Africa."
    node services/verifier.mjs --job <jobId>

The buyer funds an escrow whose spec is the hash of the prompt. The seller calls the model, saves
`evidence/job-<id>.json` (exact request and response bytes, attestation reports, signature) and submits the
result hash. The verifier re-checks everything from that file and settles. The dashboard then shows a green
Attested tag with a link to the evidence file, and anyone can re-run the verifier on it.
Use `--dry` to see the verdict without settling.

## Status of step 5

Written and syntax-checked. It runs as soon as a key with credits is available. Until a settlement on the
dashboard carries the Attested tag, no result in this repo should be treated as hardware-attested.

## Contracts (testnet)

- Escrow: `sirmos-ns2-escrow.testnet`
- Arena: `sirmos-ns2-arena.testnet`
- Test credits (NSC): `sirmos-ns2-credits.testnet`

## Tracks

Main: AI Security and Defense (signed mandates, spending limits, verified results, reputation).
Also fits: Agent Economy (paid agents), Games With Real Economies (Arena), Privacy and Private AI (TEE inference).

## Known limits

- The verifier is a trusted account. This design is trust-minimized, not trustless.
- The seller picks the attestation nonce, so freshness rests on the evidence being checked at settlement time.
- Arena trusts the dealer for which answer is real and for who wrote the decoys.
- Testnet only, with a test token. No NEAR Intents or cross-chain payment yet.
- Guard is a set of deterministic checks, not a full policy engine.
- The escrow's fee-claim function has a known owner bug that a redeploy fixes.

## Layout

    contracts/   escrow, arena, credits (Rust, near-sdk)
    verifier/    attestation and signature verification (Node)
    guard/       mandate checks and red-team corpus (Node)
    services/    buyer, seller and verifier agents for real attested jobs
    scripts/     testnet setup and end-to-end runs
    evidence/    saved evidence bundles, one per attested job
    web/         read-only dashboard
    fixtures/    one real attestation sample (no keys)
