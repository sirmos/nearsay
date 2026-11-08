// Usage:
//   NEARAI_API_KEY=... node services/dealer.mjs open-live --tier 1|2|3 [--count 1] [--minutes 30] [--stake 1]
//   node services/dealer.mjs open-call [--minutes 20] [--lane mix|everyday|work|care|crypto|creative]
//   node services/dealer.mjs open-live --tier 1|2|3|4 --call <callId>   (uses players' decoys first)
//   node services/dealer.mjs reveal <roundId>
//   node services/dealer.mjs reveal-all
// The real answer is written by the attested model on NEAR AI Cloud. Decoys come from the liar agent.
// The dealer seals the real position with a hash, and keeps the secret and the evidence bundle in
// .dealer/ (never committed) until reveal. At reveal the bundle is re-checked from scratch and published
// as evidence/round-<id>.json, so anyone can run: node services/verify-round.mjs <id>
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { randomBytes, randomInt } from "node:crypto";
import { need, view, call, nextId, sha256hex } from "./lib.mjs";
import { attestedCompletion, plainCompletion, defaultModel } from "./attest.mjs";
import { checkBundle } from "./bundle.mjs";
import { freshPrompt, TIERS } from "./prompts.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt) => { const i = rest.indexOf("--" + name); return i >= 0 ? rest[i + 1] : dflt; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
const [arena, token, dealer, liar] = [need("NS_ARENA"), need("NS_CREDITS"), need("NS_VERIFIER"), need("NS_LIAR")];
const dir = new URL("../.dealer/", import.meta.url);
const secretPath = (id) => new URL(`../.dealer/round-${id}.json`, import.meta.url);
const evidencePath = (id) => new URL(`../evidence/round-${id}.json`, import.meta.url);

async function openOne(tier, minutes, stake, callId = null, lane = "mix") {
  const t = TIERS[tier];
  const model = defaultModel();
  const liarModel = process.env.NS_LIAR_MODEL || model;
  let prompt = freshPrompt(lane);
  let human = [];
  if (callId) {
    const call = await view(arena, "get_call", { call_id: callId });
    if (!call) throw new Error(`call ${callId} does not exist`);
    if (Date.now() < Number(call.closes_ms)) throw new Error(`call ${callId} is still open for ${Math.ceil((Number(call.closes_ms) - Date.now()) / 1000)}s`);
    prompt = call.prompt;
    human = call.decoys.map((d) => ({ text: d.text, author: d.author }));
  }
  const real = await attestedCompletion({ model, prompt });
  // Players' decoys come first (at random), then the liar agent fills the gap.
  const decoys = [];
  for (const h of human.filter((x) => x.text !== real.answer).sort(() => randomInt(2) - 0.5).slice(0, t.answers - 1)) decoys.push(h);
  if (callId) console.log(`  ${decoys.length} player decoy(s) used from call ${callId}`);
  while (decoys.length < t.answers - 1) {
    const d = await plainCompletion({ model: liarModel, system: t.system, prompt });
    if (d !== real.answer && !decoys.some((x) => x.text === d)) decoys.push({ text: d, author: liar });
  }
  const realIndex = randomInt(t.answers);
  const mixed = [...decoys.slice(0, realIndex), { text: real.answer, author: null }, ...decoys.slice(realIndex)];
  const answers = mixed.map((x) => x.text);
  const authors = mixed.map((x) => x.author);
  const salt = randomBytes(16).toString("hex");
  const commit = sha256hex(`${realIndex}:${salt}`);
  const id = await nextId(arena, "get_round", "round_id");
  const closes_ms = Date.now() + minutes * 60000;
  if (callId) call(arena, "create_round_from_call", { call_id: callId, token, stake, answers, commit, closes_ms }, dealer);
  else call(arena, "create_round", { question: prompt, token, stake, answers, commit, closes_ms }, dealer);
  mkdirSync(dir, { recursive: true });
  writeFileSync(secretPath(id), JSON.stringify({ round_id: id, tier, real_index: realIndex, salt, answers, authors, prompt, bundle: real.bundle }, null, 2));
  console.log(`round ${id} (${t.name}, ${t.answers} answers) is open for ${minutes} minutes: ${prompt}`);
}

async function revealOne(id) {
  if (!existsSync(secretPath(id))) throw new Error(`no saved secret for round ${id} in .dealer/`);
  const s = JSON.parse(readFileSync(secretPath(id), "utf8"));
  const round = await view(arena, "get_round", { round_id: id });
  if (!round || round.status !== "Open") return console.log(`round ${id} is ${round ? round.status : "missing"}, skipping`);
  if (Date.now() < Number(round.closes_ms)) return console.log(`round ${id}: guessing is still open for ${Math.ceil((Number(round.closes_ms) - Date.now()) / 1000)}s`);

  // Check our own evidence from scratch before publishing it.
  const check = await checkBundle(s.bundle);
  const answerOk = check.answer === s.answers[s.real_index];
  for (const st of check.steps) console.log(`  ${st.ok ? "PASS" : "FAIL"}  ${st.name}${st.detail ? " [" + st.detail + "]" : ""}`);
  console.log(`  ${answerOk ? "PASS" : "FAIL"}  real_answer_is_the_signed_response`);
  const ok = check.ok && answerOk;

  // The published file holds the evidence plus what a checker needs: the answers, the position and the salt.
  const published = { ...s.bundle, round: { id, question: s.prompt, answers: s.answers, real_index: s.real_index, salt: s.salt } };
  const text = JSON.stringify(published, null, 2);
  mkdirSync(new URL("../evidence/", import.meta.url), { recursive: true });
  writeFileSync(evidencePath(id), text);
  const evidence = {
    ok, model_id: s.bundle.model, signature_kind: check.sigResult.signature_kind ?? "none",
    signing_address: check.sigResult.signing_address ?? "", attestation_hash: sha256hex(text),
    response_hash: check.sigResult.response_hash ?? sha256hex(Buffer.from(s.bundle.response_b64, "base64")),
  };
  const authors = s.authors || s.answers.map((_, i) => (i === s.real_index ? null : liar));
  call(arena, "reveal", { round_id: id, real_index: s.real_index, salt: s.salt, authors, evidence }, dealer);
  const after = await view(arena, "get_round", { round_id: id });
  console.log(`round ${id} is ${after.status}. The real answer was ${"ABCDEF"[s.real_index]}: ${s.answers[s.real_index]}`);
  if (!ok) console.log("  The evidence did not pass, so the round was voided and every stake is refundable.");
  else console.log(`  Evidence published: evidence/round-${id}.json. Commit and push it so the dashboard can link it.`);
}

if (cmd === "open-call") {
  const minutes = Number(flag("minutes", 20));
  const prompt = freshPrompt(flag("lane", "mix"));
  const id = await nextId(arena, "get_call", "call_id");
  call(arena, "open_call", { prompt, closes_ms: Date.now() + minutes * 60000 }, dealer);
  console.log(`call ${id} is open for ${minutes} minutes: ${prompt}`);
  console.log(`After it closes:  NEARAI_API_KEY=... node services/dealer.mjs open-live --tier 2 --call ${id}`);
} else if (cmd === "open-live") {
  const tier = Number(flag("tier", 1));
  if (!TIERS[tier]) throw new Error("tier must be 1, 2 or 3");
  const minutes = Number(flag("minutes", 30));
  const stake = String(BigInt(Math.round(Number(flag("stake", 1)) * 1e6)));
  const callId = flag("call", null) ? Number(flag("call")) : null;
  for (let i = 0; i < Number(flag("count", 1)); i++) await openOne(tier, minutes, stake, callId, flag("lane", "mix"));
  console.log("Reveal after they close:  node services/dealer.mjs reveal-all");
} else if (cmd === "reveal") {
  await revealOne(Number(positional[0]));
} else if (cmd === "reveal-all") {
  const ids = existsSync(dir) ? readdirSync(dir).map((f) => /^round-(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b) : [];
  for (const id of ids) await revealOne(id);
} else {
  throw new Error("commands: open-call | open-live | reveal <id> | reveal-all");
}
