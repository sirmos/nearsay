import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

/** Deterministic JSON: sorted keys, so the signature covers one exact byte string. */
export function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

export function generateBuyerKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("hex"),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("hex"),
  };
}

export function signMandate(mandate, privateKeyHex) {
  const key = createPrivateKey({ key: Buffer.from(privateKeyHex, "hex"), format: "der", type: "pkcs8" });
  return sign(null, Buffer.from(canonical(mandate)), key).toString("hex");
}

export function verifyMandate(mandate, signatureHex, publicKeyHex) {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyHex, "hex"), format: "der", type: "spki" });
    return verify(null, Buffer.from(canonical(mandate)), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

/**
 * A mandate states exactly what an agent may pay for.
 * Amounts are integer strings in the token's smallest unit.
 */
export function createMandate({ task, max_total, max_per_call, allowed_payees, allowed_hosts, asset, network, expires_ms, nonce }) {
  return { task, max_total, max_per_call, allowed_payees, allowed_hosts, asset, network, expires_ms, nonce };
}
