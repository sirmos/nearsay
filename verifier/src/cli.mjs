// Usage: node src/cli.mjs ../fixtures/attestation-sample.json [--offline] [--gpu]
import { readFileSync } from "node:fs";
import { verifyReport, verifyGpu } from "./attestation.mjs";

const file = process.argv[2];
if (!file) throw new Error("usage: node src/cli.mjs <fixture.json> [--offline] [--gpu]");
const online = !process.argv.includes("--offline");
const accepted = (process.env.NS_ACCEPTED_TCB || "UpToDate").split(",");
const f = JSON.parse(readFileSync(file, "utf8"));

const show = (label, r) => {
  console.log(`\n== ${label}`);
  console.log(`authenticated by Intel collateral: ${r.authenticated}${r.tcbStatus ? " (TCB " + r.tcbStatus + ")" : ""}`);
  for (const c of r.checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  [" + c.detail + "]" : ""}`);
  console.log(`  => ${r.ok ? "VERIFIED" : r.authenticated ? "REJECTED" : "NOT VERIFIED (offline, structure only)"}`);
};

const g = await verifyReport(f.report.gateway_attestation, f.nonce, { online, acceptedTcb: accepted });
show("gateway attestation", g);
for (const [i, m] of f.report.model_attestations.entries()) {
  const r = await verifyReport(m, f.nonce, { online, acceptedTcb: accepted });
  show(`model attestation #${i} (${m.model_name})`, r);
  if (process.argv.includes("--gpu")) {
    const gpu = await verifyGpu(m, f.nonce);
    console.log(`  GPU evidence: ${gpu.ok ? "PASS" : "FAIL"}  ${gpu.detail}`);
  }
}
