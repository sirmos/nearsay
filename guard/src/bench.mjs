import { authorize } from "./check.mjs";
import { attacks, legit, buyer, knownLimits } from "./corpus.mjs";

let blocked = 0, wrongReason = 0, allowed = 0;
const rows = [];

for (const c of attacks) {
  const { signed, req, ledger, now } = c.build();
  const r = authorize(signed, buyer.publicKey, ledger, req, now);
  const stopped = !r.allow;
  const reasonOk = stopped && r.reasons.includes(c.expect);
  if (stopped) blocked++;
  if (stopped && !reasonOk) wrongReason++;
  rows.push(`${stopped ? "BLOCKED" : "ALLOWED!"}  attack  ${c.name}  [${r.reasons.join(",") || "no reason"}]`);
}
for (const c of legit) {
  const { signed, req, ledger, now } = c.build();
  const r = authorize(signed, buyer.publicKey, ledger, req, now);
  if (r.allow) allowed++;
  rows.push(`${r.allow ? "allowed " : "BLOCKED!"}  legit   ${c.name}  [${r.reasons.join(",")}]`);
}

console.log(rows.join("\n"));
console.log("\nSCOREBOARD");
console.log(`  attacks blocked:            ${blocked}/${attacks.length}`);
console.log(`  blocked for the expected reason: ${blocked - wrongReason}/${attacks.length}`);
console.log(`  legitimate payments allowed: ${allowed}/${legit.length}`);
console.log(`  false-positive rate:         ${(((legit.length - allowed) / legit.length) * 100).toFixed(1)}%`);
console.log("\nWhat Guard does not stop:");
for (const l of knownLimits) console.log("  - " + l);
if (blocked !== attacks.length || allowed !== legit.length) process.exitCode = 1;
