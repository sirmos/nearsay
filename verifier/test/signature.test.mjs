import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Wallet } from "ethers";
import { verifyResponseSignature } from "../src/signature.mjs";
import { buildVerdict } from "../src/verdict.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const MODEL = "z-ai/glm-5.3-flash";
const req = Buffer.from('{"model":"z-ai/glm-5.3-flash","messages":[]}');
const res = Buffer.from('{"id":"chatcmpl-1","choices":[{"message":{"content":"hello"}}]}');

async function signed(kind, wallet, text) {
  return { signature_kind: kind, signing_algo: "ecdsa", signing_address: wallet.address, text, signature: await wallet.signMessage(text) };
}
const verifiedWith = (w, ok = true) => ({
  gateway: { ok: false, signing_algo: "ecdsa", signing_address: Wallet.createRandom().address },
  models: [{ ok, signing_algo: "ecdsa", signing_address: w.address }],
});

test("provider_tee signature over the exact bytes verifies", async () => {
  const w = Wallet.createRandom();
  const sig = await signed("provider_tee", w, `${MODEL}:${sha(req)}:${sha(res)}`);
  const r = verifyResponseSignature({ sig, requestBytes: req, responseBytes: res, modelId: MODEL, verified: verifiedWith(w) });
  assert.equal(r.ok, true);
  assert.equal(r.response_hash, sha(res));
});

test("one changed byte in the response fails", async () => {
  const w = Wallet.createRandom();
  const sig = await signed("provider_tee", w, `${MODEL}:${sha(req)}:${sha(res)}`);
  const r = verifyResponseSignature({ sig, requestBytes: req, responseBytes: Buffer.from(res.toString().replace("hello", "hullo")), modelId: MODEL, verified: verifiedWith(w) });
  assert.equal(r.ok, false);
});

test("signer not matching a verified model report fails", async () => {
  const w = Wallet.createRandom();
  const sig = await signed("provider_tee", w, `${MODEL}:${sha(req)}:${sha(res)}`);
  const r = verifyResponseSignature({ sig, requestBytes: req, responseBytes: res, modelId: MODEL, verified: verifiedWith(Wallet.createRandom()) });
  assert.equal(r.ok, false);
});

test("a report that itself failed verification does not count", async () => {
  const w = Wallet.createRandom();
  const sig = await signed("provider_tee", w, `${MODEL}:${sha(req)}:${sha(res)}`);
  const r = verifyResponseSignature({ sig, requestBytes: req, responseBytes: res, modelId: MODEL, verified: verifiedWith(w, false) });
  assert.equal(r.ok, false);
});

test("forged signature (signed by someone else) fails", async () => {
  const w = Wallet.createRandom();
  const other = Wallet.createRandom();
  const text = `${MODEL}:${sha(req)}:${sha(res)}`;
  const sig = { signature_kind: "provider_tee", signing_algo: "ecdsa", signing_address: w.address, text, signature: await other.signMessage(text) };
  const r = verifyResponseSignature({ sig, requestBytes: req, responseBytes: res, modelId: MODEL, verified: verifiedWith(w) });
  assert.equal(r.ok, false);
});

test("gateway signature verifies only against the gateway report", async () => {
  const w = Wallet.createRandom();
  const sig = await signed("gateway", w, `${sha(req)}:${sha(res)}`);
  const good = { gateway: { ok: true, signing_algo: "ecdsa", signing_address: w.address }, models: [] };
  assert.equal(verifyResponseSignature({ sig, requestBytes: req, responseBytes: res, modelId: MODEL, verified: good }).ok, true);
  assert.equal(verifyResponseSignature({ sig, requestBytes: req, responseBytes: res, modelId: MODEL, verified: verifiedWith(w) }).ok, false);
});

test("unknown signature kind is not inferred", async () => {
  const w = Wallet.createRandom();
  const sig = await signed("mystery", w, `${sha(req)}:${sha(res)}`);
  assert.equal(verifyResponseSignature({ sig, requestBytes: req, responseBytes: res, modelId: MODEL, verified: verifiedWith(w) }).ok, false);
});

test("verdict is ok only when result_hash is the signed response hash", async () => {
  const w = Wallet.createRandom();
  const sig = await signed("provider_tee", w, `${MODEL}:${sha(req)}:${sha(res)}`);
  const sr = verifyResponseSignature({ sig, requestBytes: req, responseBytes: res, modelId: MODEL, verified: verifiedWith(w) });
  assert.equal(buildVerdict({ jobId: 1, resultHash: sha(res), modelId: MODEL, sigResult: sr, attestationHash: "x" }).ok, true);
  assert.equal(buildVerdict({ jobId: 1, resultHash: "deadbeef", modelId: MODEL, sigResult: sr, attestationHash: "x" }).ok, false);
});
