// Usage: node services/sponsor.mjs <roundId> <amount in NSC> [signer account]
// Adds a prize to an open round. Players who guess right split it. If nobody is right it returns to you.
import { need, call } from "./lib.mjs";
const [id, amount, signer = need("NS_BUYER")] = process.argv.slice(2);
if (!id || !amount) throw new Error("usage: node services/sponsor.mjs <roundId> <amount NSC> [signer]");
const raw = String(BigInt(Math.round(Number(amount) * 1e6)));
call(need("NS_CREDITS"), "ft_transfer_call", { receiver_id: need("NS_ARENA"), amount: raw, msg: `S:${id}` }, signer, { deposit: "1 yoctoNEAR" });
console.log(`sponsored round ${id} with ${amount} NSC`);
