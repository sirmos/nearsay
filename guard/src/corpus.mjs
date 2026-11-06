import { createMandate, generateBuyerKey, signMandate } from "./mandate.mjs";
import { Ledger } from "./check.mjs";

export const NOW = 1_800_000_000_000;
export const buyer = generateBuyerKey();
const attacker = generateBuyerKey();

export const baseMandate = createMandate({
  task: "Buy up to three market-data lookups",
  max_total: "5000000",
  max_per_call: "2000000",
  allowed_payees: ["datafeed.testnet"],
  allowed_hosts: ["api.datafeed.example"],
  asset: "sirmos-ns-credits.testnet",
  network: "near:testnet",
  expires_ms: NOW + 3_600_000,
  nonce: "demo-1",
});

const goodReq = {
  payee: "datafeed.testnet",
  amount: "1000000",
  asset: "sirmos-ns-credits.testnet",
  network: "near:testnet",
  resource_url: "https://api.datafeed.example/v1/prices?symbol=NEAR",
};

const signedBase = () => ({ mandate: baseMandate, signature: signMandate(baseMandate, buyer.privateKey) });
const withReq = (patch) => ({ ...goodReq, ...patch });

// Each case: name, kind, expect (reason code for attacks), build() -> { signed, req, ledger, now }
const mk = (name, kind, expect, over = {}) => ({
  name, kind, expect,
  build: () => ({ signed: signedBase(), req: goodReq, ledger: new Ledger(0n), now: NOW, ...over }),
});

export const attacks = [
  mk("payee swapped to an attacker account", "attack", "PAYEE_NOT_ALLOWED", { req: withReq({ payee: "attacker.testnet" }) }),
  mk("look-alike payee using a Cyrillic letter", "attack", "PAYEE_MALFORMED", { req: withReq({ payee: "d\u0430tafeed.testnet" }) }),
  mk("payee with an extra suffix", "attack", "PAYEE_NOT_ALLOWED", { req: withReq({ payee: "datafeed.testnet.evil" }) }),
  mk("amount one unit over the per-call cap", "attack", "OVER_PER_CALL", { req: withReq({ amount: "2000001" }) }),
  mk("enormous amount", "attack", "OVER_PER_CALL", { req: withReq({ amount: "1" + "0".repeat(30) }) }),
  mk("amount in exponent notation", "attack", "AMOUNT_MALFORMED", { req: withReq({ amount: "2e6" }) }),
  mk("negative amount", "attack", "AMOUNT_MALFORMED", { req: withReq({ amount: "-5" }) }),
  mk("amount in hex", "attack", "AMOUNT_MALFORMED", { req: withReq({ amount: "0x1e8480" }) }),
  mk("amount with leading space", "attack", "AMOUNT_MALFORMED", { req: withReq({ amount: " 1000" }) }),
  mk("decimal amount", "attack", "AMOUNT_MALFORMED", { req: withReq({ amount: "1.5" }) }),
  mk("many small payments past the total cap", "attack", "OVER_TOTAL", { ledger: new Ledger(4_500_000n), req: withReq({ amount: "600000" }) }),
  mk("URL with credentials hiding the real host", "attack", "HOST_NOT_ALLOWED", { req: withReq({ resource_url: "https://api.datafeed.example@evil.example/x" }) }),
  mk("allowed host used as a subdomain of an attacker domain", "attack", "HOST_NOT_ALLOWED", { req: withReq({ resource_url: "https://api.datafeed.example.evil.example/x" }) }),
  mk("downgrade to http", "attack", "URL_NOT_HTTPS", { req: withReq({ resource_url: "http://api.datafeed.example/x" }) }),
  mk("non-default port", "attack", "URL_NONDEFAULT_PORT", { req: withReq({ resource_url: "https://api.datafeed.example:8443/x" }) }),
  mk("look-alike host using a Cyrillic letter", "attack", "HOST_NOT_ALLOWED", { req: withReq({ resource_url: "https://\u0430pi.datafeed.example/x" }) }),
  mk("trailing-dot host", "attack", "HOST_NOT_ALLOWED", { req: withReq({ resource_url: "https://api.datafeed.example./x" }) }),
  mk("different token", "attack", "ASSET_MISMATCH", { req: withReq({ asset: "other-token.testnet" }) }),
  mk("different network", "attack", "NETWORK_MISMATCH", { req: withReq({ network: "near:mainnet" }) }),
  mk("expired mandate", "attack", "EXPIRED", { now: NOW + 3_600_001 }),
  mk("mandate edited after signing (raised cap)", "attack", "BAD_SIGNATURE", {
    signed: { mandate: { ...baseMandate, max_total: "999999999" }, signature: signMandate(baseMandate, buyer.privateKey) },
  }),
  mk("mandate signed by the attacker's own key", "attack", "BAD_SIGNATURE", {
    signed: { mandate: baseMandate, signature: signMandate(baseMandate, attacker.privateKey) },
  }),
  mk("missing payee", "attack", "PAYEE_MALFORMED", { req: withReq({ payee: undefined }) }),
  mk("missing URL", "attack", "URL_MALFORMED", { req: withReq({ resource_url: undefined }) }),
];

export const legit = [
  mk("normal payment", "legit", null),
  mk("payment exactly at the per-call cap", "legit", null, { req: withReq({ amount: "2000000" }) }),
  mk("second payment within the total", "legit", null, { ledger: new Ledger(2_000_000n), req: withReq({ amount: "2000000" }) }),
  mk("payment that lands exactly on the total cap", "legit", null, { ledger: new Ledger(3_000_000n), req: withReq({ amount: "2000000" }) }),
  mk("smallest possible payment", "legit", null, { req: withReq({ amount: "1" }) }),
  mk("deep path and query on the allowed host", "legit", null, { req: withReq({ resource_url: "https://api.datafeed.example/v2/a/b/c?x=1&y=%20z" }) }),
  mk("host written in capitals", "legit", null, { req: withReq({ resource_url: "HTTPS://API.DATAFEED.EXAMPLE/x" }) }),
];

/** Things Guard deliberately does NOT stop. Listed in the scoreboard so nobody oversells it. */
export const knownLimits = [
  "An injected instruction that stays inside the mandate (right payee, right host, under the caps) is allowed.",
  "A mandate that is too generous is the buyer's mistake; Guard enforces it exactly as signed.",
  "Guard does not read or judge the content of the purchased resource.",
  "A compromised wallet key can sign a new mandate. Key custody is out of scope here.",
];
