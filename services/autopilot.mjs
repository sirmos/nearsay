// The dealer on autopilot. Run it once and it keeps the Arena alive by itself:
//   - keeps one open round per tier (Easy, Medium, Hard) and a Daily Boss,
//   - opens a Be the Liar call and builds a round from the players' decoys,
//   - reveals every round the moment guessing closes, then publishes the evidence.
// Real answers always come from the attested model. Nothing here is typed in by hand.
// Needs: NEARAI_API_KEY, source scripts/testnet.env, the dealer key in the legacy keychain.
//   AUTOPILOT_MINUTES (default 330)  how long this run lasts
//   ROUND_MINUTES     (default 45)   guessing window per round
//   AUTOPILOT_MAX_ROUNDS (default 8) rounds this run may open (caps NEAR AI credit use)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { need, view, call } from "./lib.mjs";
import { processJobs } from "./runner.mjs";

const arena = need("NS_ARENA");
const deadline = Date.now() + Number(process.env.AUTOPILOT_MINUTES || 330) * 60000;
const WINDOW = Number(process.env.ROUND_MINUTES || 360);   // guessing window per round
const MAX = Number(process.env.AUTOPILOT_MAX_ROUNDS || 10);
const OVERLAP = 90;   // open the next round of a tier when the current one has this many minutes left, so one is always open
const PRIZE = { 1: 3, 2: 5, 3: 8, 4: 15 };   // house prize in NSC added to each round
const LANES = ["everyday", "work", "care", "crypto", "creative"];
let made = 0, callPlan = null, bossDone = false, fails = 0;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dealer = (...args) => {
  const soft = args[0] === "reveal";
  try { const out = execFileSync(process.execPath, ["services/dealer.mjs", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env }); fails = 0; return out; }
  catch (e) {
    log("dealer", args[0], "failed:", (() => { const L = String(e.stderr || e.message).split("\n").filter(Boolean); const k = L.filter((x) => /Error|failed|HTTP|credit/i.test(x) && !/^\s+at /.test(x)); return (k.length ? k : L).slice(0, 3).join(" | ").slice(0, 600); })());
    if (!soft && ++fails >= 6) { log("six dealer calls failed in a row, stopping so the problem is visible instead of looping"); process.exit(1); }
    return "";
  }
};

const voidTried = new Map();
const known = new Map();   // finished rounds never change
async function allRounds() {
  const out = [];
  for (let i = 1; i < 2000; i++) {
    if (known.has(i)) { out.push(known.get(i)); continue; }
    const r = await view(arena, "get_round", { round_id: i });
    if (!r) break;
    if (r.status !== "Open") known.set(i, r);
    out.push(r);
  }
  return out;
}
const tierOf = (r) => Math.min(Math.max(r.answers.length - 1, 1), 4);

// A copy of what the site reads from the chain, committed to the repo. The site shows it instantly on load,
// so a slow or blocked public RPC node never leaves a visitor with an empty page.
const SNAP = new URL("../web/snapshot.json", import.meta.url);
let snapDirty = false, lastSnapPush = 0;
async function writeSnapshot(rounds) {
  const token = need("NS_CREDITS"), escrow = need("NS_ESCROW");
  const jobs = [], calls = [];
  for (let i = 1; i < 500; i++) { const j = await view(escrow, "get_job", { job_id: i }); if (!j) break; jobs.push(j); }
  for (let i = 1; i < 200; i++) { const c = await view(arena, "get_call", { call_id: i }); if (!c) break; calls.push(c); }
  const reps = [];
  for (const account of [...new Set(jobs.map((j) => j.seller))]) reps.push({ account, rep: await view(escrow, "get_reputation", { account_id: account }) });
  const bals = [];
  for (const account of [process.env.NS_BUYER, process.env.NS_SELLER, process.env.NS_LIAR, process.env.NS_VERIFIER].filter(Boolean)) bals.push({ account, balance: await view(token, "ft_balance_of", { account_id: account }) });
  const body = JSON.stringify({ jobs, rounds, calls, reps, bals });
  let old = ""; try { old = JSON.stringify((({ at, ...rest }) => rest)(JSON.parse(readFileSync(SNAP, "utf8")))); } catch { /* first snapshot */ }
  if (old === body) return;
  writeFileSync(SNAP, JSON.stringify({ at: Date.now(), ...JSON.parse(body) }));
  snapDirty = true;
}
function publish() {
  try {
    execFileSync("git", ["add", "evidence", "web/snapshot.json"], { stdio: "ignore" });
    const dirty = execFileSync("git", ["status", "--porcelain", "evidence", "web/snapshot.json"], { encoding: "utf8" }).trim();
    if (!dirty) return;
    execFileSync("git", ["commit", "-m", "Add round evidence and data snapshot"], { stdio: "ignore" });
    snapDirty = false; lastSnapPush = Date.now();
    for (let i = 0; i < 3; i++) {
      try { execFileSync("git", ["pull", "--rebase", "--autostash"], { stdio: "ignore" }); execFileSync("git", ["push"], { stdio: "ignore" }); log("evidence published"); return; }
      catch { /* try again */ }
    }
    log("could not push evidence yet, will retry next pass");
  } catch (e) { log("publish skipped:", e.message); }
}

// A house prize on top of the stakes: winners split it, and it returns to the house if nobody is right.
function addPrize(out, tier) {
  const m = /round (\d+) /.exec(out || "");
  if (!m) return;
  const raw = String(BigInt(PRIZE[tier]) * 1000000n);
  try {
    call(need("NS_CREDITS"), "faucet", { amount: raw }, need("NS_VERIFIER"));
    call(need("NS_CREDITS"), "ft_transfer_call", { receiver_id: arena, amount: raw, msg: "S:" + m[1] }, need("NS_VERIFIER"), { deposit: "1 yoctoNEAR" });
    log("added a " + PRIZE[tier] + " NSC house prize to round " + m[1]);
  } catch (e) { log("prize skipped:", String(e.stderr || e.message).split("\n").filter(Boolean).slice(-1)[0]); }
}
const openRound = (tier, minutes, extra = []) => {
  const out = dealer("open-live", "--tier", String(tier), "--minutes", String(minutes), ...extra);
  if (out) { made++; addPrize(out, tier); }
  return !!out;
};

log(`autopilot starts: ${WINDOW}-minute rounds, up to ${MAX} rounds, ends in ${Math.round((deadline - Date.now()) / 60000)} minutes`);
const lane = LANES[Math.floor(Date.now() / 21600000) % LANES.length];
{
  const out = dealer("open-call", "--minutes", "25", "--lane", lane);
  const m = /call (\d+) is open/.exec(out);
  if (m) { callPlan = { id: Number(m[1]), opensAt: Date.now() + 25 * 60000 + 20000, used: false }; log("opened call", m[1], "lane", lane); }
}

for (;;) {
  try {
    const rounds = await allRounds();
    try { await writeSnapshot(rounds); } catch (e) { log("snapshot skipped:", e.message); }
    if (snapDirty && Date.now() - lastSnapPush > 10 * 60000) publish();
    const now = Date.now();
    const left = { 1: 0, 2: 0, 3: 0, 4: 0 };   // open rounds with enough time left, per tier
    let closed = [];
    for (const r of rounds) {
      if (r.status !== "Open") continue;
      const mins = (Number(r.closes_ms) - now) / 60000;
      if (mins <= 0) closed.push(r.id); else if (mins > OVERLAP || tierOf(r) === 4) left[tierOf(r)]++;
    }
    for (const id of closed) {
      if (!existsSync(new URL(`../.dealer/round-${id}.json`, import.meta.url))) {
        // The secret for this round was lost, so it can never be revealed. Void it once the grace period is over so every stake is refunded.
        if (!voidTried.has(id) || Date.now() - voidTried.get(id) > 30 * 60000) {
          voidTried.set(id, Date.now());
          try { call(arena, "void_round", { round_id: id }, need("NS_VERIFIER")); log("voided round", id, "(its secret was lost), stakes refunded"); } catch (e) { /* grace period not over yet */ }
        }
        continue;
      }
      log("revealing round", id); dealer("reveal", String(id));
    }
    if (closed.length) publish();

    if (callPlan && !callPlan.used && now >= callPlan.opensAt && made < MAX) {
      callPlan.used = true;
      if (openRound(2, WINDOW, ["--call", String(callPlan.id)])) { log("opened a round from call", callPlan.id); left[2]++; }
    }
    if (left[4] === 0 && made < MAX && openRound(4, 20 * 60)) log("opened the Daily Boss");
    for (const t of [1, 2, 3]) if (left[t] === 0 && made < MAX && openRound(t, WINDOW)) log("opened a tier", t, "round");
  } catch (e) { log("pass failed:", e.message); }
  try { if (await processJobs(log)) publish(); } catch (e) { log("job runner failed:", e.message); }
  if (Date.now() > deadline) break;
  await new Promise((s) => setTimeout(s, 60000));
}
publish();
log(`autopilot done, opened ${made} round(s). Rounds still open are revealed by the next run.`);
