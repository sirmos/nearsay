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
const RPCS = [RPC, "https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
export async function view(account, method, args = {}) {
  let last;
  // Public RPC nodes answer 429 ("too many requests") when a shared GitHub runner asks too often.
  // Space the calls out a little and, on 429 or a server error, wait and try again.
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const url of RPCS) {
      const gap = Date.now() - lastCall;
      if (gap < 120) await sleep(120 - gap);
      lastCall = Date.now();
      try { return await viewAt(url, account, method, args); } catch (e) {
        last = e;
        if (!/fetch failed|ECONN|ETIMEDOUT|HTTP 5|HTTP 4/.test(String(e.message))) throw e;
      }
    }
    await sleep(Math.min(2000 * 2 ** attempt, 30000));
  }
  throw last;
}
async function viewAt(url, account, method, args) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: { request_type: "call_function", finality: "final", account_id: account, method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
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

// The first id that does not exist yet. Ids are handed out one after another, so a doubling step plus a
// binary search finds it in about a dozen calls instead of reading every record from 1.
export async function nextId(contract, method, key) {
  const has = async (i) => (await view(contract, method, { [key]: i })) !== null;
  if (!(await has(1))) return 1;
  let lo = 1, hi = 2;
  while (await has(hi)) { lo = hi; hi *= 2; if (hi > 1_000_000) throw new Error("too many ids"); }
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (await has(mid)) lo = mid; else hi = mid; }
  return hi;
}
