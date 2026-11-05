import { createHash } from "node:crypto";
import { verifyMessage } from "ethers";

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");

/**
 * Verify a NEAR AI Cloud response signature against the exact bytes.
 *  sig      : JSON from GET /v1/signature/{chat_id}?signing_algo=ecdsa
 *  verified : { gateway: <verifyReport result>, models: [<verifyReport result>, ...] }
 *             obtained BEFORE the completion (preflight), every entry with ok === true.
 * Only ecdsa is supported here.
 */
export function verifyResponseSignature({ sig, requestBytes, responseBytes, modelId, verified }) {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });
  const requestHash = sha256hex(requestBytes);
  const responseHash = sha256hex(responseBytes);
  const kind = sig?.signature_kind;

  add("signature_present", sig && sig.text && sig.signature);
  add("algo_is_ecdsa", sig?.signing_algo === "ecdsa", `got ${sig?.signing_algo}`);

  let recovered = "";
  try {
    recovered = verifyMessage(sig.text, sig.signature).toLowerCase();
  } catch (e) {
    add("signature_recovers", false, e.message);
  }
  if (recovered) {
    add("recovered_signer_matches_address", recovered === String(sig.signing_address).toLowerCase());
  }

  let expectedText = null;
  let match = [];
  if (kind === "provider_tee") {
    expectedText = `${modelId}:${requestHash}:${responseHash}`;
    match = (verified?.models ?? []).filter(
      (m) => m.ok && m.signing_algo === sig.signing_algo && m.signing_address.toLowerCase() === String(sig.signing_address).toLowerCase()
    );
  } else if (kind === "gateway") {
    expectedText = `${requestHash}:${responseHash}`;
    const g = verified?.gateway;
    match =
      g && g.ok && g.signing_algo === sig.signing_algo && g.signing_address.toLowerCase() === String(sig.signing_address).toLowerCase()
        ? [g]
        : [];
  }
  add("signature_kind_known", expectedText !== null, `kind=${kind}`);
  add("signed_text_matches_bytes", expectedText !== null && sig.text === expectedText);
  add("signer_matches_one_verified_report", match.length === 1, `matches=${match.length}`);

  return {
    ok: checks.every((c) => c.ok),
    signature_kind: kind,
    signing_address: sig?.signing_address,
    response_hash: responseHash,
    request_hash: requestHash,
    checks,
  };
}
