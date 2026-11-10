# Nearsay

**Agents get paid only for provable work.**

A buyer's money waits in escrow on NEAR. A seller agent runs the job on NEAR AI Cloud and submits the result
hash plus an evidence bundle. A verifier re-checks the hardware attestation (Intel TDX and NVIDIA GPU) and the
signature over the exact response bytes. Only a result that checks out releases the payment. Every settled
job feeds a reputation ledger, so an agent's record comes only from paid, verified work.

On top of that sits **Spot the Machine**, a skill game that makes the proof something you can feel in 30
seconds: each round, one answer was really written by the attested model and the others are written by liar
agents. You guess, you stake, and the reveal ships the hardware proof.

Built for the NEAR Hackathon with AI assistance (Claude Code). Runs on NEAR testnet with a free test token (NSC).
Live dashboard: https://sirmos.github.io/nearsay/ (reads straight from testnet)

## Why this is useful to NEAR

- Every round and every job calls **NEAR AI Cloud** for real attested inference, so the game turns the hardware
  proof into usage people understand.
- Every stake, payout, pass and prize is a **NEAR transaction**. Sign-in is a NEAR account.
- The reputation ledger is readable by any other NEAR contract (`get_reputation`), so another marketplace can
  check an agent before hiring it.
- A **season pass paid in NEAR** unlocks the hardest tiers and the daily Boss, and funds a prize pool.
- **Sponsored rounds** let a project add a prize to a round about its own product.

## What runs, and how to check it

| Part | What it does | Check it |
|---|---|---|
| Escrow | Holds tokens. Pays the seller only on an accepted verdict, otherwise refunds. A failed transfer is credited, never lost. | Step 1, 4 |
| Reputation | Built only from settled escrows, with a per-pair cap so friends cannot inflate each other. | Step 1 |
| Verifier | Checks Intel TDX quotes, RTMR3 replay, NVIDIA GPU evidence and the response signature. | Step 2 |
| Guard | Spending-limit checks on signed mandates. 24 of 24 attacks blocked, 7 of 7 legitimate payments allowed. | Step 3 |
| Arena | Players stake on which answer the model really wrote. The real position is sealed with a hash before guessing. Sponsors can add prizes. | Step 4, 5 |
| Season pass | Paid in NEAR. Unlocks tiers and the Boss. Fills a prize pool. | Step 1 |

## Try it: do X, see Y

**0. Hire an agent in the browser** (needs the new escrow deployed, see below)

Open `web/hire.html` (or the Hire page of the dashboard), sign in with a funded testnet account, write a task, pick
the Research Agent and press Create the job, then Fund the escrow. Within a few minutes the receipt shows the agent's
hardware proof verified and the agent paid. Pick the Unproven Agent instead and the verifier rejects the work, so
you are refunded in full. Add payees in step 3 and the payout is split between them in one transaction.

**1. Contract tests**

    cd contracts/escrow && cargo test --lib
    cd ../arena && cargo test --lib
    cd ../credits && cargo test --lib
    cd ../pass && cargo test --lib

See every test pass, including the failed-transfer recovery tests.

**2. Verify a real hardware attestation**

    cd verifier && npm install && npm test
    node src/cli.mjs ../fixtures/attestation-sample.json --gpu

See `VERIFIED` for the gateway and the model, and GPU evidence `PASS`.
`--offline` skips the Intel and NVIDIA network checks, and an offline run is never reported as verified.

**3. Guard scoreboard**

    cd guard && npm install && npm test
    node src/bench.mjs

**4. A real attested job (needs a NEAR AI Cloud key with credits)**

    source scripts/testnet.env
    NEARAI_API_KEY=... bash scripts/real-run.sh

See a buyer fund an escrow, the seller call the model, the verifier re-check everything, and the escrow pay the
seller minus a 1% fee. The dashboard shows a green Attested tag and links `evidence/job-<id>.json`.

**5. Play and verify an Arena round**

Open the dashboard, sign in with a NEAR testnet account (steps on the page), get free test credits and guess.
After guessing closes the dealer reveals. Then check the dealer yourself, with no trust and no key:

    source scripts/testnet.env
    cd verifier && npm install && cd ..
    node services/verify-round.mjs <roundId>

See `PASS` on every line: the evidence file matches the hash stored on chain, the sealed position matches the
commitment, the question is the signed request, the real answer is the signed response, and the Intel, GPU and
signature checks pass.

## The game

Players guess which answer the attested model wrote. Prompts are generated fresh for each round and the answer
does not exist until the model writes it, so there is nothing to look up. **Be the Liar.** The dealer opens a public call with a prompt. Players write fake answers. The dealer then builds a
round from the machine's real attested answer plus some player decoys, topped up by the liar agent. If a decoy fools
players, its author earns the liar share. The contract checks at reveal that every player decoy is credited to the
player who wrote it, so the dealer cannot steal or invent authorship. Prompts come in lanes (everyday, work, care,
crypto, creative). The lane changes the setting, never the skill: the question is always "which one did the machine
write?", and prompts ask for voice and writing, never for facts that can be looked up.

Rank comes from rounds you play:
Rookie, Detective, Verifier, Elite, Legend. Tiers unlock as you rank up. Tier 1 has 2 answers, tier 2 has 3 and
tier 3 has 4, with decoys written to imitate the model more closely at each step. Payout rules, from the contract:
the pot is every stake minus a 1% fee. Right guessers split it. If liars fooled anyone, liars take 20% of it. A
round with no right guess and no fooled guess refunds everyone. A round whose evidence fails is voided and refunded.

## Contracts

Addresses are in `scripts/testnet.env` and shown in the footer of the dashboard. Deploy a fresh set with
`bash scripts/bootstrap.sh`.

## Tracks

Main: AI Security and Defense. Also fits: Agent Economy, Games With Real Economies, Privacy and Private AI.

## Known limits

- The verifier and the dealer are trusted accounts, so this is trust-minimized, not trustless. What the dealer
  cannot do: change the sealed position after guessing opens, or pass off a decoy as real without producing a
  signed response that matches. What the chain does not do: check the hardware proof itself. Anyone can, with
  `verify-round.mjs`.
- The dealer knows the answer in advance, so the dealer account is barred from guessing.
- Player decoys are written freely. The dealer chooses which ones to use, so the dealer can favour some players.
- Tier locks and ranks are computed from on-chain rounds by the dashboard. They are not enforced by the contract.
- The season pass prize payout is run by the contract owner. It is not trustless.
- Real-money mainnet play is not built, and a real-money version could count as gambling in some places.
- Testnet only, with a test token. NEAR Intents (paying from other chains) is on the roadmap and not built. The Hire page lists it as "next" and does not fake a quote.
- The hire job runner is our own GitHub Actions workflow, so a job can wait up to a few minutes for pickup.
- The seller picks the attestation nonce, so freshness rests on checking the evidence at settlement time.
- Guard is a set of deterministic checks, not a full policy engine.

## Layout

    contracts/   escrow, arena, credits, pass (Rust, near-sdk)
    verifier/    attestation and signature verification (Node)
    guard/       mandate checks and red-team corpus (Node)
    services/    buyer, seller, verifier and dealer agents, plus verify-round and sponsor
    scripts/     bootstrap (fresh deployment), redeploy-arena, real-run (one attested run)
    evidence/    evidence bundles, one per attested job or round
    web/         dashboard
    fixtures/    one real attestation sample (no keys)
