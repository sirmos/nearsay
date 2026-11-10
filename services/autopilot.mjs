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
import { need, view } from "./lib.mjs";

const arena = need("NS_ARENA");
const deadline = Date.now() + Number(process.env.AUTOPILOT_MINUTES || 330) * 60000;
const WINDOW = Number(process.env.ROUND_MINUTES || 45);
const MAX = Number(process.env.AUTOPILOT_MAX_ROUNDS || 8);
const LANES = ["everyday", "work", "care", "crypto", "creative"];
let made = 0, callPlan = null, bossDone = false, fails = 0;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dealer = (...args) => {
  try { const out = execFileSync(process.execPath, ["services/dealer.mjs", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env }); fails = 0; return out; }
  catch (e) {
    log("dealer", args[0], "failed:", (() => { const L = String(e.stderr || e.message).split("\n").filter(Boolean); const k = L.filter((x) => /Error|failed|HTTP|credit/i.test(x) && !/^\s+at /.test(x)); return (k.length ? k : L).slice(0, 3).join(" | ").slice(0, 600); })());
    if (++fails >= 6) { log("six dealer calls failed in a row, stopping so the problem is visible instead of looping"); process.exit(1); }
    return "";
  }
};
const timeLeft = (mins) => Date.now() + (mins + 8) * 60000 < deadline;

async function allRounds() {
  const out = [];
  for (let i = 1; i < 500; i++) { const r = await view(arena, "get_round", { round_id: i }); if (!r) break; out.push(r); }
  return out;
}
const tierOf = (r) => Math.min(Math.max(r.answers.length - 1, 1), 4);

function publish() {
  try {
    execFileSync("git", ["add", "evidence"], { stdio: "ignore" });
    const dirty = execFileSync("git", ["status", "--porcelain", "evidence"], { encoding: "utf8" }).trim();
    if (!dirty) return;
    execFileSync("git", ["commit", "-m", "Add round evidence"], { stdio: "ignore" });
    for (let i = 0; i < 3; i++) {
      try { execFileSync("git", ["pull", "--rebase", "--autostash"], { stdio: "ignore" }); execFileSync("git", ["push"], { stdio: "ignore" }); log("evidence published"); return; }
      catch { /* try again */ }
    }
    log("could not push evidence yet, will retry next pass");
  } catch (e) { log("publish skipped:", e.message); }
}

log(`autopilot starts: ${WINDOW}-minute rounds, up to ${MAX} rounds, ends in ${Math.round((deadline - Date.now()) / 60000)} minutes`);
// Plan one Be the Liar call at the start of the run.
if (timeLeft(25 + WINDOW)) {
  const lane = LANES[Math.floor(Date.now() / 21600000) % LANES.length];
  const out = dealer("open-call", "--minutes", "25", "--lane", lane);
  const m = /call (\d+) is open/.exec(out);
  if (m) { callPlan = { id: Number(m[1]), opensAt: Date.now() + 25 * 60000 + 20000, used: false }; log("opened call", m[1], "lane", lane); }
}

for (;;) {
  try {
    const rounds = await allRounds();
    const now = Date.now();
    const openByTier = { 1: 0, 2: 0, 3: 0, 4: 0 };
    let needReveal = false;
    for (const r of rounds) {
      if (r.status !== "Open") continue;
      if (now >= Number(r.closes_ms)) needReveal = true; else openByTier[tierOf(r)]++;
    }
    if (needReveal) { log("revealing closed rounds"); dealer("reveal-all"); publish(); }

    // The call's round, once the call has closed.
    if (callPlan && !callPlan.used && now >= callPlan.opensAt && made < MAX && timeLeft(WINDOW)) {
      callPlan.used = true;
      const out = dealer("open-live", "--tier", "2", "--call", String(callPlan.id), "--minutes", String(WINDOW));
      if (out) { made++; log("opened a round from call", callPlan.id); }
    }
    // Daily Boss: one if none was opened in the last 24 hours.
    const bossRecent = rounds.some((r) => tierOf(r) === 4 && Number(r.closes_ms) > now - 24 * 3600000);
    if (!bossDone && !bossRecent && made < MAX && timeLeft(120)) {
      bossDone = true;
      if (dealer("open-live", "--tier", "4", "--minutes", "120")) { made++; log("opened the Daily Boss"); }
    }
    // Keep one open round per tier.
    for (const t of [1, 2, 3]) {
      if (openByTier[t] === 0 && made < MAX && timeLeft(WINDOW) && !(t === 2 && callPlan && !callPlan.used)) {
        if (dealer("open-live", "--tier", String(t), "--minutes", String(WINDOW))) { made++; log("opened a tier", t, "round"); }
      }
    }
    const stillOpen = rounds.some((r) => r.status === "Open");
    if (Date.now() > deadline - 5 * 60000 && !stillOpen) break;
    if (made >= MAX && !stillOpen && (!callPlan || callPlan.used)) break;
  } catch (e) { log("pass failed:", e.message); }
  try { if (await processJobs(log)) publish(); } catch (e) { log("job runner failed:", e.message); }
  if (Date.now() > deadline) break;
  await new Promise((s) => setTimeout(s, 60000));
}
dealer("reveal-all"); publish();
log(`autopilot done, opened ${made} round(s)`);
