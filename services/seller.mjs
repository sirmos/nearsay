// Usage: NEARAI_API_KEY=... node services/seller.mjs <jobId> "<prompt>"
// Does the work on NEAR AI Cloud, saves a self-contained evidence bundle, and submits the result hash.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { need, view, call, sha256hex, NEARAI } from "./lib.mjs";

const jobId = Number(process.argv[2]);
const prompt = process.argv[3];
if (!jobId || !prompt) throw new Error('usage: NEARAI_API_KEY=... node services/seller.mjs <jobId> "<prompt>"');
const key = process.env.NEARAI_API_KEY;
if (!key) throw new Error("Set NEARAI_API_KEY in this shell only (never in a file).");
const [escrow, seller] = [need("NS_ESCROW"), need("NS_SELLER")];

const job = await view(escrow, "get_job", { job_id: jobId });
if (!job) throw new Error(`job ${jobId} does not exist`);
if (job.seller !== seller) throw new Error(`job ${jobId} belongs to ${job.seller}, not ${seller}`);
if (job.status !== "Funded") throw new Error(`job ${jobId} is ${job.status}, expected Funded`);
if (job.spec_hash !== sha256hex(prompt)) throw new Error("this prompt does not match the job's spec_hash");

let model = process.env.NS_MODEL;
if (!model) model = JSON.parse(readFileSync(new URL("../fixtures/attestation-sample.json", import.meta.url), "utf8")).report.model_attestations[0].model_name;
console.log(`model: ${model}`);

const auth = { Authorization: `Bearer ${key}` };

// 1. Preflight evidence with a nonce we choose.
const nonce = randomBytes(32).toString("hex");
const q = new URLSearchParams({ signing_algo: "ecdsa", nonce, model, provider: "near" });
const pre = await fetch(`${NEARAI}/attestation/report?${q}`, { headers: { ...auth, Accept: "application/json", "x-no-aliasing": "true" } });
if (!pre.ok) throw new Error(`attestation report failed: HTTP ${pre.status} ${await pre.text()}`);
const report = await pre.json();
console.log(`preflight: gateway report + ${report.model_attestations?.length ?? 0} model report(s)`);

// 2. The completion. Keep the exact bytes of the request and the response.
const requestText = JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: false });
const comp = await fetch(`${NEARAI}/chat/completions`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json", "x-no-aliasing": "true", "Accept-Encoding": "identity" },
  body: requestText,
});
const responseBytes = Buffer.from(await comp.arrayBuffer());
if (!comp.ok) throw new Error(`completion failed: HTTP ${comp.status} ${responseBytes.toString()}`);
const chatId = JSON.parse(responseBytes.toString()).id;
console.log(`completion ok, chat id ${chatId}`);

// 3. The response signature (retry briefly: it can lag the completion).
let sig;
for (let i = 0; i < 10; i++) {
  const r = await fetch(`${NEARAI}/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`, { headers: { ...auth, Accept: "application/json" } });
  const body = r.ok ? await r.json() : null;
  if (body && body.signature && !body.error_code) { sig = body; break; }
  await new Promise((s) => setTimeout(s, 1500));
}
if (!sig) throw new Error("no signature available. Check that the account has credits, then retry.");
console.log(`signature kind: ${sig.signature_kind}`);

// 4. Save the bundle (no API key inside) and submit.
const bundle = {
  version: 1, job_id: jobId, model,
  request_b64: Buffer.from(requestText).toString("base64"),
  response_b64: responseBytes.toString("base64"),
  preflight: { nonce, report },
  signature: sig,
};
mkdirSync(new URL("../evidence/", import.meta.url), { recursive: true });
const text = JSON.stringify(bundle, null, 2);
writeFileSync(new URL(`../evidence/job-${jobId}.json`, import.meta.url), text);
const bundleHash = sha256hex(text);
const resultHash = sha256hex(responseBytes);
call(escrow, "submit_result", { job_id: jobId, result_hash: resultHash, evidence_ref: `sha256:${bundleHash}` }, seller);
console.log(`submitted. result_hash ${resultHash}\nevidence evidence/job-${jobId}.json (sha256 ${bundleHash})`);
console.log(`\nNext: node services/verifier.mjs --job ${jobId}`);
