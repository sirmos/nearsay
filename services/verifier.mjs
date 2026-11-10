// Usage: node services/verifier.mjs [--job N] [--dry] [--watch]
// Re-checks the evidence bundle from scratch, then settles the escrow with the verdict.
//   --dry    print the verdict and do not settle
//   --watch  keep polling for submitted jobs
import { readFileSync, existsSync } from "node:fs";
import { need, view, call, nextId, sha256hex } from "./lib.mjs";
import { verifyReport, verifyGpu } from "../verifier/src/attestation.mjs";
import { verifyResponseSignature } from "../verifier/src/signature.mjs";
import { buildVerdict } from "../verifier/src/verdict.mjs";

const args = process.argv.slice(2);
const only = args.includes("--job") ? Number(args[args.indexOf("--job") + 1]) : null;
const dry = args.includes("--dry");
const watch = args.includes("--watch");
const [escrow, verifier] = [need("NS_ESCROW"), need("NS_VERIFIER")];
const accepted = (process.env.NS_ACCEPTED_TCB || "UpToDate").split(",");

async function check(job) {
  const path = new URL(`../evidence/job-${job.id}.json`, import.meta.url);
  const steps = [];
  const add = (name, ok, detail = "") => { steps.push({ name, ok: !!ok, detail }); };
  if (!existsSync(path)) return { missing: true };
  const text = readFileSync(path, "utf8");
  const bundle = JSON.parse(text);
  const bundleHash = sha256hex(text);

  add("evidence_ref_matches_file", job.evidence_ref === `sha256:${bundleHash}`);
  const requestBytes = Buffer.from(bundle.request_b64, "base64");
  const responseBytes = Buffer.from(bundle.response_b64, "base64");
  add("result_hash_matches_response", sha256hex(responseBytes) === job.result_hash);
  let prompt = "";
  try { prompt = JSON.parse(requestBytes.toString()).messages[0].content; } catch {}
  add("request_matches_job_spec", sha256hex(prompt) === job.spec_hash);

  const { nonce, report } = bundle.preflight;
  const gateway = await verifyReport(report.gateway_attestation, nonce, { online: true, acceptedTcb: accepted });
  add("gateway_attestation_verified", gateway.ok, gateway.authenticated ? "Intel-authenticated" : "not authenticated");
  const models = [];
  let gpuOk = report.model_attestations?.length > 0;
  for (const m of report.model_attestations ?? []) {
    const r = await verifyReport(m, nonce, { online: true, acceptedTcb: accepted });
    models.push(r);
    const gpu = await verifyGpu(m, nonce);
    gpuOk = gpuOk && gpu.ok;
  }
  add("model_attestations_verified", models.length > 0 && models.every((m) => m.ok), `${models.length} report(s)`);
  add("gpu_evidence_pass", gpuOk);

  const sigResult = verifyResponseSignature({
    sig: bundle.signature, requestBytes, responseBytes, modelId: bundle.model,
    verified: { gateway, models: models.filter((m) => m.ok) },
  });
  for (const c of sigResult.checks) add("signature: " + c.name, c.ok, c.detail);

  const verdict = buildVerdict({ jobId: job.id, resultHash: job.result_hash, modelId: bundle.model, sigResult, attestationHash: bundleHash });
  verdict.ok = verdict.ok && steps.every((s) => s.ok);
  return { steps, verdict };
}

async function handle(job) {
  console.log(`\n== job ${job.id} (${job.status})`);
  let r;
  try { r = await check(job); }
  catch (e) {
    r = { steps: [{ name: "evidence_can_be_checked", ok: false, detail: String(e.message).slice(0, 120) }],
      verdict: buildVerdict({ jobId: job.id, resultHash: job.result_hash, modelId: "none", sigResult: null, attestationHash: "" }) };
  }
  if (r.missing) return console.log(`  no evidence/job-${job.id}.json here yet, waiting`);
  for (const s of r.steps) console.log(`  ${s.ok ? "PASS" : "FAIL"}  ${s.name}${s.detail ? "  [" + s.detail + "]" : ""}`);
  console.log(`  => verdict ok=${r.verdict.ok}, signature_kind=${r.verdict.signature_kind}`);
  if (dry) return console.log("  --dry: not settling");
  call(escrow, "settle", { job_id: job.id, verdict: r.verdict }, verifier);
  const after = await view(escrow, "get_job", { job_id: job.id });
  console.log(`  settled on-chain, job status: ${after.status}`);
  if (r.verdict.ok && after.status !== "Settled") console.log("  The verdict was ok but the escrow refunded: its accepted_kinds does not include " + r.verdict.signature_kind + ". Redeploy the escrow with that kind accepted.");
}

async function pass() {
  const end = await nextId(escrow, "get_job", "job_id");
  for (let id = only ?? 1; id < (only ? only + 1 : end); id++) {
    const job = await view(escrow, "get_job", { job_id: id });
    if (job && job.status === "Submitted" && job.evidence_ref?.startsWith("sha256:")) await handle(job);
  }
}
do { await pass(); if (watch) await new Promise((s) => setTimeout(s, 8000)); } while (watch);
