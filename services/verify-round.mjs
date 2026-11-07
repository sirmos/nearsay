// Usage: node services/verify-round.mjs <roundId>
// Anyone can run this. It trusts nothing the dealer says: it re-checks the evidence file from scratch
// and compares it with what the Arena contract recorded on NEAR.
import { readFileSync, existsSync } from "node:fs";
import { need, view, sha256hex } from "./lib.mjs";
import { checkBundle } from "./bundle.mjs";

const id = Number(process.argv[2]);
const path = new URL(`../evidence/round-${id}.json`, import.meta.url);
if (!id) throw new Error("usage: node services/verify-round.mjs <roundId>");
if (!existsSync(path)) throw new Error(`evidence/round-${id}.json not found. Pull the latest repo first.`);
const text = readFileSync(path, "utf8");
const bundle = JSON.parse(text);
const round = await view(need("NS_ARENA"), "get_round", { round_id: id });
if (!round) throw new Error(`round ${id} is not on chain`);
const steps = [];
const add = (name, ok, detail = "") => steps.push({ name, ok: !!ok, detail });
add("round_is_settled_on_chain", round.status === "Settled", round.status);
add("file_matches_on_chain_evidence_hash", round.evidence?.attestation_hash === sha256hex(text));
add("position_and_salt_match_the_sealed_commit", sha256hex(`${bundle.round.real_index}:${bundle.round.salt}`) === round.commit);
add("answers_match_the_round", JSON.stringify(bundle.round.answers) === JSON.stringify(round.answers) && bundle.round.real_index === round.real_index);
const prompt = JSON.parse(Buffer.from(bundle.request_b64, "base64").toString()).messages[0].content;
add("question_is_the_signed_request", prompt === round.question);
const c = await checkBundle(bundle);
for (const s of c.steps) add(s.name, s.ok, s.detail);
add("real_answer_is_the_signed_response", c.answer === round.answers[round.real_index]);
for (const s of steps) console.log(`${s.ok ? "PASS" : "FAIL"}  ${s.name}${s.detail ? "  [" + s.detail + "]" : ""}`);
console.log(steps.every((s) => s.ok) ? "\nRound verified." : "\nRound NOT verified.");
process.exit(steps.every((s) => s.ok) ? 0 : 1);
