// The job runner. Finds jobs that buyers funded from the website, has the chosen agent do the work,
// then asks the verifier to check the evidence and settle. No one types anything.
//   - lead agent (NS_SELLER): real NEAR AI Cloud answer with a hardware attestation  -> verified -> paid
//   - unattested agent (NS_LIAR): answers with no hardware proof                     -> rejected -> buyer refunded
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { need, view, call, nextId } from "./lib.mjs";

const tried = new Set();
const finished = new Set();
const hasKey = (acct) => existsSync(join(homedir(), ".near-credentials", "testnet", acct + ".json"));
const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: process.env });
const tail = (r) => String((r.stderr || "") + (r.stdout || "")).split("\n").filter(Boolean).slice(-3).join(" | ");

export async function processJobs(log, maxJobs = 15) {
  const escrow = need("NS_ESCROW"), token = need("NS_CREDITS"), verifier = need("NS_VERIFIER");
  const sellers = { [need("NS_SELLER")]: "services/seller.mjs", [need("NS_LIAR")]: "services/seller-unattested.mjs" };
  const end = await nextId(escrow, "get_job", "job_id");
  let changed = false;
  for (let id = 1; id < end; id++) {
    if (finished.has(id)) continue;
    const job = await view(escrow, "get_job", { job_id: id });
    if (!job) continue;
    if (job.status === "Settled" || job.status === "Refunded") { finished.add(id); continue; }
    if (job.status === "Funded" && job.spec_text && sellers[job.seller] && hasKey(job.seller) && !tried.has(id) && tried.size < maxJobs) {
      tried.add(id);
      if (BigInt(job.amount) > 20n * 1000000n) { log("job", id, "skipped: more than 20 NSC"); continue; }
      log("job", id, "funded, running", job.seller);
      const r = run(sellers[job.seller], [String(id), job.spec_text]);
      if (r.status !== 0) { log("job", id, "agent failed:", tail(r)); continue; }
      changed = true;
    }
    const now = await view(escrow, "get_job", { job_id: id });
    if (now && now.status === "Submitted" && hasKey(verifier)) {
      for (const sp of now.splits || []) {
        try { call(token, "register", { account_id: sp.account }, verifier); } catch (e) { /* already registered, or it will be credited for withdrawal */ }
      }
      const v = run("services/verifier.mjs", ["--job", String(id)]);
      log("job", id, v.status === 0 ? "verified and settled" : "verifier problem: " + tail(v));
      changed = true;
    }
  }
  return changed;
}
