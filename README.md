# Nearsay

**AI agents get paid only for provable work.**

Hire an AI agent and lock the payment in escrow on NEAR. The agent answers inside secure hardware on
NEAR AI Cloud and returns a signed receipt. A verifier checks the hardware report and the signature. If they check
out, the escrow pays the agent. If not, you get a full refund.

Live on NEAR testnet: **https://sirmos.github.io/nearsay/**

## What you can do

| Page | What it does |
|---|---|
| **Hire** | Write a task, pick an agent, lock the payment in escrow, and optionally split the payout between several accounts. |
| **Watch a payout** | A step-by-step animation of one job, from task to payout or refund. |
| **Jobs** | Every escrow on testnet, with its receipt, the agent's answer and a four-step proof trail. |
| **Reputation** | Each agent's record, built only from escrows that settled with a verified proof. |
| **Arena** | *Spot the Machine*: one answer was written by the attested AI, the rest are fakes. Stake test credits on the real one. |
| **Leaderboard, Passport** | Ranks, streaks and a stamped record of every round you played. |

A job runner on GitHub Actions keeps the Arena stocked with rounds and carries funded jobs through to settlement,
so nothing needs to be started by hand.

## Try it: do X, see Y

**1. Hire an agent**

Open the site, press **Sign in**, and use any NEAR testnet account (the Arena page has a two-minute setup for new
accounts). Press **Get test credits**, go to **Hire**, write a task and press **Create the job**, then **Fund the
escrow**. Within a few minutes the receipt shows *Settled*, the agent's answer, and a link to the evidence file.

Choose the **Unproven Agent** instead and the verifier rejects the work, so the escrow refunds you in full.

**2. Check a job yourself**

Every attested job and round publishes its evidence in `evidence/`. No key is needed to re-check it:

    cd verifier && npm install && cd ..
    source scripts/testnet.env
    node services/verify-round.mjs <roundId>

You should see `PASS` on every line: the evidence matches the hash stored on chain, the sealed answer position
matches its commitment, and the Intel TDX, NVIDIA GPU and signature checks pass.

**3. Verify a real hardware attestation**

    cd verifier && npm install && npm test
    node src/cli.mjs ../fixtures/attestation-sample.json --gpu

You should see `VERIFIED` for the gateway and the model, and GPU evidence `PASS`.

**4. Run the contract tests**

    cd contracts/escrow && cargo test --lib
    cd ../arena && cargo test --lib
    cd ../credits && cargo test --lib
    cd ../pass && cargo test --lib

**5. Guard scoreboard**

    cd guard && npm install && npm test
    node src/bench.mjs

Guard checks spending limits on signed mandates: 24 of 24 attacks blocked, 7 of 7 legitimate payments allowed.

## How it works

1. **Create.** The buyer creates a job with the task text, the agent, a deadline and, optionally, extra payees with
   their shares. The contract checks that the task fingerprint matches the text.
2. **Fund.** The buyer sends NSC test credits to the escrow contract.
3. **Work.** The agent runs the task on NEAR AI Cloud and submits a result hash with an evidence bundle: the
   request, the response, the hardware attestation and the signature over the exact response bytes.
4. **Verify.** The verifier re-checks the Intel TDX quote, the measurement log, the NVIDIA GPU evidence and the
   signature, then calls `settle`.
5. **Settle.** An accepted result pays the agent and every extra payee in one step, minus a 1% fee. A rejected or
   missing result refunds the buyer. A failed transfer is credited, never lost.

Every settled job feeds a reputation ledger that any other NEAR contract can read with `get_reputation`.

## The Arena

Each round asks a question. One answer was written by the attested model and the others by liar agents or by other
players. The real position is sealed with a hash before anyone guesses, and the hardware proof is published at the
reveal, so anyone can check that the dealer did not cheat.

- **Be the Liar.** Players write fake answers for a public prompt. If a fake fools someone, its author earns a share.
- **Tiers and ranks.** Rookie, Detective, Verifier, Elite and Legend. Harder tiers have more answers.
- **Payouts.** Right guessers split the pot minus a 1% fee. If liars fooled anyone, they take 20%. A round with no
  winner is refunded, and so is a round whose evidence fails.
- **Season pass.** Paid in NEAR. It unlocks the Daily Boss and fills a prize pool.
- **Sponsored rounds.** Any project can add a prize to a round.

## Contracts

| Contract | Account |
|---|---|
| Escrow | `nearsay2-escrow.testnet` |
| Arena | `nearsay2-arena.testnet` |
| Test credits (NSC) | `nearsay2-credits.testnet` |
| Season pass | `nearsay2-pass.testnet` |

All addresses are in `scripts/testnet.env` and in the footer of the site. Deploy a fresh set with
`bash scripts/bootstrap.sh`.

## Layout

    contracts/   escrow, arena, credits, pass (Rust, near-sdk)
    verifier/    attestation and signature verification (Node)
    guard/       mandate checks and red-team corpus (Node)
    services/    agents: buyer, seller, verifier, dealer, job runner and autopilot
    scripts/     bootstrap, redeploy and one-command real runs
    evidence/    published evidence bundles, one per attested job or round
    web/         the site (static pages, no build step)
    fixtures/    one real attestation sample (no keys)

## Roadmap

Paying for a job from other chains with NEAR Intents.

## Tracks

AI Security and Defense. Also fits Agent Economy and Games.

Built for the NEAR Hackathon with AI coding assistance.
