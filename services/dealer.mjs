// Usage:
//   node services/dealer.mjs open "<question>" "<real answer>" "<decoy>" "<decoy>" [--minutes 30] [--stake 1]
//   node services/dealer.mjs reveal <roundId>
// The dealer commits to where the real answer sits, opens the round, and reveals it after guessing closes.
// The secret (position and salt) is kept in .dealer/ on this machine and is never committed.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomBytes, randomInt } from "node:crypto";
import { need, view, call, nextId, sha256hex } from "./lib.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt) => { const i = rest.indexOf("--" + name); return i >= 0 ? rest[i + 1] : dflt; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
const [arena, token, dealer, liar] = [need("NS_ARENA"), need("NS_CREDITS"), need("NS_VERIFIER"), need("NS_LIAR")];
const secretPath = (id) => new URL(`../.dealer/round-${id}.json`, import.meta.url);

if (cmd === "open") {
  const [question, real, ...decoys] = positional;
  if (!question || !real || decoys.length < 1) throw new Error('usage: open "<question>" "<real answer>" "<decoy>" ["<decoy>"...]');
  const minutes = Number(flag("minutes", 30));
  const stake = String(BigInt(Math.round(Number(flag("stake", 1)) * 1e6)));
  const realIndex = randomInt(decoys.length + 1);
  const answers = [...decoys.slice(0, realIndex), real, ...decoys.slice(realIndex)];
  const salt = randomBytes(16).toString("hex");
  const commit = sha256hex(`${realIndex}:${salt}`);
  const id = await nextId(arena, "get_round", "round_id");
  call(arena, "create_round", { question, token, stake, answers, commit, closes_ms: Date.now() + minutes * 60000 }, dealer);
  mkdirSync(new URL("../.dealer/", import.meta.url), { recursive: true });
  writeFileSync(secretPath(id), JSON.stringify({ round_id: id, real_index: realIndex, salt, answers }, null, 2));
  console.log(`round ${id} is open for ${minutes} minutes. Players can guess on the dashboard.`);
  console.log(`Reveal it after it closes:  node services/dealer.mjs reveal ${id}`);
} else if (cmd === "reveal") {
  const id = Number(positional[0]);
  if (!id || !existsSync(secretPath(id))) throw new Error(`no saved secret for round ${id} in .dealer/`);
  const s = JSON.parse(readFileSync(secretPath(id), "utf8"));
  const round = await view(arena, "get_round", { round_id: id });
  if (!round || round.status !== "Open") throw new Error(`round ${id} is ${round ? round.status : "missing"}`);
  if (Date.now() < Number(round.closes_ms)) throw new Error(`guessing is still open for ${Math.ceil((Number(round.closes_ms) - Date.now()) / 1000)}s`);
  // Test evidence: the real answer is the dealer's word, not a hardware-attested model output.
  const evidence = { ok: true, model_id: "demo", signature_kind: "provider_tee", signing_address: "", attestation_hash: "demo", response_hash: sha256hex(s.answers[s.real_index]) };
  const authors = s.answers.map((_, i) => (i === s.real_index ? null : liar));
  call(arena, "reveal", { round_id: id, real_index: s.real_index, salt: s.salt, authors, evidence }, dealer);
  const after = await view(arena, "get_round", { round_id: id });
  console.log(`round ${id} is ${after.status}. The real answer was ${"ABCDEF"[s.real_index]}: ${s.answers[s.real_index]}`);
  for (const who of [liar, dealer]) { try { call(arena, "claim", { token }, who); } catch { /* nothing to claim */ } }
  console.log("Winners claim from the dashboard.");
} else {
  throw new Error('commands: open | reveal');
}
