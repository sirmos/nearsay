// Usage: NEARAI_API_KEY=... node services/seller-unattested.mjs <jobId> "<prompt>"
// An agent that answers with NO hardware proof. The verifier cannot check it, so it rejects the result
// and the buyer is refunded. This is the safety-net demonstration: bad work never gets paid.
import { writeFileSync, mkdirSync } from "node:fs";
import { need, view, call, sha256hex } from "./lib.mjs";
import { plainCompletion, defaultModel } from "./attest.mjs";

const jobId = Number(process.argv[2]);
const prompt = process.argv[3];
if (!jobId || !prompt) throw new Error('usage: NEARAI_API_KEY=... node services/seller-unattested.mjs <jobId> "<prompt>"');
const [escrow, seller] = [need("NS_ESCROW"), need("NS_LIAR")];
const job = await view(escrow, "get_job", { job_id: jobId });
if (!job) throw new Error(`job ${jobId} does not exist`);
if (job.seller !== seller) throw new Error(`job ${jobId} belongs to ${job.seller}, not ${seller}`);
if (job.status !== "Funded") throw new Error(`job ${jobId} is ${job.status}, expected Funded`);
if (job.spec_hash !== sha256hex(prompt)) throw new Error("this prompt does not match the job's spec_hash");

const model = defaultModel();
const answer = await plainCompletion({ model, prompt });
const requestText = JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: false });
const responseText = JSON.stringify({ choices: [{ message: { role: "assistant", content: answer } }] });
const bundle = {
  version: 1, job_id: jobId, model,
  request_b64: Buffer.from(requestText).toString("base64"),
  response_b64: Buffer.from(responseText).toString("base64"),
  preflight: { nonce: "", report: { gateway_attestation: null, model_attestations: [] } },
  signature: null,
};
mkdirSync(new URL("../evidence/", import.meta.url), { recursive: true });
const text = JSON.stringify(bundle, null, 2);
writeFileSync(new URL(`../evidence/job-${jobId}.json`, import.meta.url), text);
call(escrow, "submit_result", { job_id: jobId, result_hash: sha256hex(Buffer.from(responseText)), evidence_ref: `sha256:${sha256hex(text)}` }, seller);
console.log(`submitted an answer with no hardware proof for job ${jobId}. The verifier will reject it.`);
