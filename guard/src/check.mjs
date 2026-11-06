import { verifyMandate } from "./mandate.mjs";

const AMOUNT = /^[1-9][0-9]{0,38}$/; // positive integer string only: no sign, decimal, exponent, hex or spaces
const PAYEE = /^[a-z0-9._-]{2,64}$/;  // ASCII only, so look-alike Unicode letters are malformed

/** Running total of what has been paid under one mandate. */
export class Ledger {
  constructor(spent = 0n) {
    this.spent = BigInt(spent);
  }
}

function mandateProblems(m) {
  const bad = [];
  const isAmt = (x) => typeof x === "string" && AMOUNT.test(x);
  if (!m || typeof m !== "object") return ["MANDATE_INVALID"];
  if (!isAmt(m.max_total) || !isAmt(m.max_per_call)) bad.push("MANDATE_INVALID");
  else if (BigInt(m.max_per_call) > BigInt(m.max_total)) bad.push("MANDATE_INVALID");
  if (!Array.isArray(m.allowed_payees) || m.allowed_payees.length === 0) bad.push("MANDATE_INVALID");
  if (!Array.isArray(m.allowed_hosts) || m.allowed_hosts.length === 0) bad.push("MANDATE_INVALID");
  if (typeof m.asset !== "string" || typeof m.network !== "string") bad.push("MANDATE_INVALID");
  if (typeof m.expires_ms !== "number") bad.push("MANDATE_INVALID");
  return bad;
}

/**
 * Decide whether one payment request is allowed under a signed mandate.
 *  signed          : { mandate, signature }
 *  trustedBuyerKey : the buyer's public key, held by the wallet. NEVER taken from the mandate.
 *  req             : { payee, amount, asset, network, resource_url }
 * Returns { allow, reasons }. On allow, the amount is added to the ledger.
 */
export function authorize(signed, trustedBuyerKey, ledger, req, now = Date.now()) {
  const reasons = [];
  const m = signed?.mandate;

  if (!signed || !verifyMandate(m, signed.signature, trustedBuyerKey)) {
    return { allow: false, reasons: ["BAD_SIGNATURE"] };
  }
  const mp = mandateProblems(m);
  if (mp.length) return { allow: false, reasons: mp };
  if (now >= m.expires_ms) reasons.push("EXPIRED");

  // Amount
  let amount = null;
  if (typeof req?.amount !== "string" || !AMOUNT.test(req.amount)) reasons.push("AMOUNT_MALFORMED");
  else {
    amount = BigInt(req.amount);
    if (amount > BigInt(m.max_per_call)) reasons.push("OVER_PER_CALL");
    if (ledger.spent + amount > BigInt(m.max_total)) reasons.push("OVER_TOTAL");
  }

  // Payee: exact match only
  if (typeof req?.payee !== "string" || !PAYEE.test(req.payee)) reasons.push("PAYEE_MALFORMED");
  else if (!m.allowed_payees.includes(req.payee)) reasons.push("PAYEE_NOT_ALLOWED");

  // Asset and network: exact match
  if (req?.asset !== m.asset) reasons.push("ASSET_MISMATCH");
  if (req?.network !== m.network) reasons.push("NETWORK_MISMATCH");

  // Resource URL: https, no credentials, default port, exact host
  try {
    const u = new URL(req.resource_url);
    if (u.protocol !== "https:") reasons.push("URL_NOT_HTTPS");
    if (u.username || u.password) reasons.push("URL_HAS_CREDENTIALS");
    if (u.port) reasons.push("URL_NONDEFAULT_PORT");
    if (!m.allowed_hosts.includes(u.hostname)) reasons.push("HOST_NOT_ALLOWED");
  } catch {
    reasons.push("URL_MALFORMED");
  }

  if (reasons.length) return { allow: false, reasons };
  ledger.spent += amount;
  return { allow: true, reasons: [] };
}
