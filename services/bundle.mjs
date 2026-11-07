// Re-checks an evidence bundle from scratch: Intel and GPU attestation, then the signature over the exact bytes.
import { verifyReport, verifyGpu } from "../verifier/src/attestation.mjs";
import { verifyResponseSignature } from "../verifier/src/signature.mjs";
import { answerOf } from "./attest.mjs";

export async function checkBundle(bundle, { acceptedTcb = (process.env.NS_ACCEPTED_TCB || "UpToDate").split(",") } = {}) {
  const steps = [];
  const add = (name, ok, detail = "") => steps.push({ name, ok: !!ok, detail });
  const requestBytes = Buffer.from(bundle.request_b64, "base64");
  const responseBytes = Buffer.from(bundle.response_b64, "base64");
  const { nonce, report } = bundle.preflight;
  const gateway = await verifyReport(report.gateway_attestation, nonce, { online: true, acceptedTcb });
  add("gateway_attestation_verified", gateway.ok, gateway.authenticated ? "Intel-authenticated" : "not authenticated");
  const models = [];
  let gpuOk = (report.model_attestations?.length ?? 0) > 0;
  for (const m of report.model_attestations ?? []) {
    models.push(await verifyReport(m, nonce, { online: true, acceptedTcb }));
    gpuOk = gpuOk && (await verifyGpu(m, nonce)).ok;
  }
  add("model_attestations_verified", models.length > 0 && models.every((m) => m.ok), `${models.length} report(s)`);
  add("gpu_evidence_pass", gpuOk);
  const sigResult = verifyResponseSignature({
    sig: bundle.signature, requestBytes, responseBytes, modelId: bundle.model,
    verified: { gateway, models: models.filter((m) => m.ok) },
  });
  for (const c of sigResult.checks) add("signature: " + c.name, c.ok, c.detail);
  add("signature_over_exact_bytes", sigResult.ok);
  return { ok: steps.every((s) => s.ok), steps, sigResult, answer: answerOf(responseBytes) };
}
