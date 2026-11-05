/**
 * Build the verdict the escrow's settle() expects.
 * Rule: the seller's result_hash IS the SHA-256 of the exact response body.
 * ok is true only if the response signature verified and the hash matches.
 */
export function buildVerdict({ jobId, resultHash, modelId, sigResult, attestationHash }) {
  const ok = !!sigResult?.ok && sigResult.response_hash === resultHash;
  return {
    job_id: jobId,
    result_hash: resultHash,
    ok,
    model_id: modelId,
    signature_kind: sigResult?.signature_kind ?? "none",
    signing_address: sigResult?.signing_address ?? "",
    attestation_hash: attestationHash ?? "",
  };
}
