// Calls NEAR AI Cloud and returns the answer together with a self-contained evidence bundle.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { NEARAI } from "./lib.mjs";

export const defaultModel = () =>
  process.env.NS_MODEL ||
  JSON.parse(readFileSync(new URL("../fixtures/attestation-sample.json", import.meta.url), "utf8")).report.model_attestations[0].model_name;

export const answerOf = (responseBytes) => {
  try { return String(JSON.parse(Buffer.from(responseBytes).toString()).choices[0].message.content || "").trim(); } catch { return ""; }
};

const apiKey = () => {
  const k = process.env.NEARAI_API_KEY;
  if (!k) throw new Error("Set NEARAI_API_KEY in this shell only (never in a file).");
  return k;
};

// A plain, unattested completion. Used for the liar agents' decoys.
export async function plainCompletion({ model, system, prompt, temperature = 1 }) {
  const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }];
  const r = await fetch(`${NEARAI}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", "x-no-aliasing": "true" },
    body: JSON.stringify({ model, messages, temperature, stream: false }),
  });
  if (!r.ok) throw new Error(`liar completion failed: HTTP ${r.status} ${await r.text()}`);
  const text = String((await r.json()).choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("the liar model returned an empty answer");
  return text;
}

// The real, attested completion: preflight attestation, exact response bytes, response signature.
export async function attestedCompletion({ model, prompt }) {
  const auth = { Authorization: `Bearer ${apiKey()}` };
  const nonce = randomBytes(32).toString("hex");
  const q = new URLSearchParams({ signing_algo: "ecdsa", nonce, model, provider: "near" });
  const pre = await fetch(`${NEARAI}/attestation/report?${q}`, { headers: { ...auth, Accept: "application/json", "x-no-aliasing": "true" } });
  if (!pre.ok) throw new Error(`attestation report failed: HTTP ${pre.status} ${await pre.text()}`);
  const report = await pre.json();
  const requestText = JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: false });
  const comp = await fetch(`${NEARAI}/chat/completions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", "x-no-aliasing": "true", "Accept-Encoding": "identity" },
    body: requestText,
  });
  const responseBytes = Buffer.from(await comp.arrayBuffer());
  if (!comp.ok) throw new Error(`completion failed: HTTP ${comp.status} ${responseBytes.toString()}`);
  const chatId = JSON.parse(responseBytes.toString()).id;
  let sig;
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${NEARAI}/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`, { headers: { ...auth, Accept: "application/json" } });
    const body = r.ok ? await r.json() : null;
    if (body && body.signature && !body.error_code) { sig = body; break; }
    await new Promise((s) => setTimeout(s, 1500));
  }
  if (!sig) throw new Error("no signature available. Check that the account has credits, then retry.");
  const answer = answerOf(responseBytes);
  if (!answer) throw new Error("the model returned an empty answer");
  return {
    answer, responseBytes,
    bundle: {
      version: 1, model,
      request_b64: Buffer.from(requestText).toString("base64"),
      response_b64: responseBytes.toString("base64"),
      preflight: { nonce, report },
      signature: sig,
    },
  };
}
