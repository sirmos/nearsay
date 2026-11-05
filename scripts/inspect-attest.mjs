import { readFileSync } from "node:fs";
const f = JSON.parse(readFileSync(new URL("../fixtures/attestation-sample.json", import.meta.url)));
const m = f.report.model_attestations[0];
const q = Buffer.from(m.intel_quote, "hex");
const hex = (b) => b.toString("hex");
const at = (o, n) => q.subarray(o, o + n);

// TDX quote v4: 48-byte header, then the TD report body.
console.log("quote bytes:", q.length);
console.log("version:", q.readUInt16LE(0), "| tee type:", "0x" + q.readUInt32LE(4).toString(16));
const mrtd = hex(at(184, 48));
const rtmr = [0, 1, 2, 3].map((i) => hex(at(376 + 48 * i, 48)));
const reportData = hex(at(568, 64));
console.log("report_data (from quote):", reportData);

const addr = m.signing_address.toLowerCase().replace(/^0x/, "");
console.log("contains signing address:", reportData.includes(addr));
console.log("contains our nonce:      ", reportData.includes(f.nonce.toLowerCase()));
console.log("request_nonce echoes ours:", m.request_nonce === f.nonce);

const t = m.info.tcb_info;
console.log("mrtd matches JSON: ", mrtd === t.mrtd);
rtmr.forEach((r, i) => console.log(`rtmr${i} matches JSON:`, r === t["rtmr" + i]));
console.log("gateway signing address:", f.report.gateway_attestation.signing_address);
console.log("model signing address:  ", m.signing_address);
console.log("nvidia_payload present:", !!m.nvidia_payload, "| chars:", m.nvidia_payload?.length);
