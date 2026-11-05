import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const KEY = process.env.NEARAI_API_KEY;
if (!KEY) throw new Error("Set NEARAI_API_KEY first");
const MODEL = process.argv[2] || "z-ai/glm-5.3-flash";
const nonce = randomBytes(32).toString("hex");
const url = `https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(MODEL)}&signing_algo=ecdsa&nonce=${nonce}`;

const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
const j = await r.json();
writeFileSync(
  new URL("../fixtures/attestation-sample.json", import.meta.url),
  JSON.stringify({ nonce, model: MODEL, report: j }, null, 2)
);
console.log("saved fixtures/attestation-sample.json, status", r.status);
