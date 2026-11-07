// Usage: node services/buyer.mjs "<prompt>" [amount in NSC, default 5]
// Creates a job whose spec_hash is sha256(prompt) and funds it from the buyer account.
import { need, view, call, nextId, sha256hex } from "./lib.mjs";

const prompt = process.argv[2];
if (!prompt) throw new Error('usage: node services/buyer.mjs "<prompt>" [amount NSC]');
const nsc = Number(process.argv[3] ?? 5);
const amount = String(BigInt(Math.round(nsc * 1e6)));
const [escrow, token, buyer, seller] = [need("NS_ESCROW"), need("NS_CREDITS"), need("NS_BUYER"), need("NS_SELLER")];

const bal = BigInt(await view(token, "ft_balance_of", { account_id: buyer }));
if (bal < BigInt(amount)) {
  console.log("buyer balance is low, taking test credits from the faucet");
  call(token, "faucet", { amount: "100000000" }, buyer);
}
const jobId = await nextId(escrow, "get_job", "job_id");
console.log(`creating job ${jobId}: ${nsc} NSC for ${seller}`);
call(escrow, "create_job", {
  seller, token, amount, spec_hash: sha256hex(prompt), deadline_ms: Date.now() + 60 * 60 * 1000,
}, buyer);
console.log("funding the escrow");
call(token, "ft_transfer_call", { receiver_id: escrow, amount, msg: String(jobId) }, buyer, { deposit: "1 yoctoNEAR" });
const job = await view(escrow, "get_job", { job_id: jobId });
console.log(`job ${jobId} status: ${job.status}`);
console.log(`\nNext, as the seller:\n  NEARAI_API_KEY=... node services/seller.mjs ${jobId} ${JSON.stringify(prompt)}`);
