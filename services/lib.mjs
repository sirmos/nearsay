// Shared helpers for the Nearsay services. Needs: source scripts/testnet.env
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export const NEARAI = "https://cloud-api.near.ai/v1";
export const RPC = "https://rpc.testnet.near.org";
export const sha256hex = (b) => createHash("sha256").update(b).digest("hex");

export function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Run: source scripts/testnet.env`);
  return v;
}

// Read-only contract call through the public RPC. Returns parsed JSON (or null).
export async function view(account, method, args = {}) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: { request_type: "call_function", finality: "final", account_id: account, method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.data || j.error.message);
  if (j.result?.error) throw new Error(j.result.error);
  return JSON.parse(Buffer.from(j.result.result).toString());
}

// Signed transaction through the near CLI (keys come from your legacy keychain).
export function call(contract, method, args, signer, { gas = "100 Tgas", deposit = "0 NEAR" } = {}) {
  const out = execFileSync("near", [
    "contract", "call-function", "as-transaction", contract, method,
    "json-args", JSON.stringify(args),
    "prepaid-gas", gas, "attached-deposit", deposit,
    "sign-as", signer, "network-config", "testnet", "sign-with-legacy-keychain", "send",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out;
}

export async function nextId(contract, method, key) {
  for (let i = 1; i < 1000; i++) if ((await view(contract, method, { [key]: i })) === null) return i;
  throw new Error("too many ids");
}
