# Nearsay

Agents get paid only for provable work.

A buyer's money waits in escrow on NEAR. The seller agent submits a result. A verifier checks the
hardware proof (TEE attestation) behind that result. Only a result that checks out releases the payment.
Every settled job feeds a reputation ledger, so an agent's record is built from paid, checked work.

Built for the NEAR Hackathon. Built with AI assistance (Claude Code).
Everything runs on NEAR testnet with a free test token (NSC). No real money is involved.

## What is real and what is not

| Part | Status |
|---|---|
| Escrow, reputation, Arena and test-token contracts | Deployed and running on testnet. Unit tests pass. |
| Verifier: Intel TDX quote check, RTMR3 replay, NVIDIA GPU check, response signature check | Works on a real NEAR AI Cloud attestation saved in `fixtures/`. |
| Guard: spending-limit checks on signed mandates, with a red-team scoreboard | Works locally. 24 of 24 attacks blocked, 7 of 7 legitimate payments allowed. |
| Settlement runs on testnet | Use **demo evidence** (hand-written verdicts). They test the money logic. They are not attested. |
| Live attested job (real model call, signed, verified, then settled) | Not yet shown on-chain. See Known limits. |

Nothing here is called "verified" unless the verifier actually verified it.

## Try it: do X, see Y

**1. Run the contract tests**

    cd contracts/escrow && cargo test --lib
    cd ../arena && cargo test --lib
    cd ../credits && cargo test --lib

You should see all tests pass (escrow 7, arena 11, credits 2).

**2. Verify a real hardware attestation**

    cd verifier && npm install && npm test
    node src/cli.mjs ../fixtures/attestation-sample.json --gpu

You should see `VERIFIED` for the gateway and the model, and GPU evidence `PASS`.
Add `--offline` to skip the Intel and NVIDIA network checks. An offline run is never reported as VERIFIED.

**3. Run the Guard scoreboard**

    cd guard && npm install && npm test
    node src/bench.mjs

You should see 24/24 attacks blocked and 7/7 legitimate payments allowed, followed by a list of known limits.

**4. Play the whole thing on testnet**

    bash scripts/demo.sh

You should see an escrowed job settle (the seller is paid, minus a 1% fee) and an Arena round pay out.
This needs the `near` CLI and the testnet keys in the author's Codespace. Without them, use the live
dashboard and the explorer links below to see a completed run.

**5. Watch it live**

    python3 -m http.server 8080 -d web

Open the page. You should see the proof rail for the latest job, a jobs table, reputation, balances and the Arena.
Everything is read straight from NEAR testnet.

## Contracts (testnet)

- Escrow: `sirmos-ns-escrow.testnet`
- Arena: `sirmos-ns-arena.testnet`
- Test credits (NSC): `sirmos-ns-credits.testnet`

Explorer: https://testnet.nearblocks.io/address/sirmos-ns-escrow.testnet

## Tracks

Main: AI Security and Defense (signed mandates, spending limits, reputation).
Also fits: Agent Economy (paid agents), Games With Real Economies (Arena), Privacy and Private AI (TEE-attested inference).

## Known limits

- The verifier is a trusted account. This design is trust-minimized, not trustless.
- Arena trusts the dealer for which answer is real and for who wrote the decoys.
- Settlements so far use demo evidence. The verifier already passes a real attestation; wiring a live signed
  response into a settlement needs NEAR AI Cloud credits.
- Testnet only. No NEAR Intents or cross-chain step yet.
- Guard is a set of deterministic checks, not a full policy engine. Its scoreboard lists what it does not cover.

## Layout

    contracts/   escrow, arena, credits (Rust, near-sdk)
    verifier/    attestation and signature verification (Node)
    guard/       mandate checks and red-team corpus (Node)
    scripts/     testnet setup and end-to-end runs
    web/         read-only dashboard
    fixtures/    one real attestation sample (no keys)
