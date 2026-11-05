import { createHash } from "node:crypto";

export const hexBytes = (v) => Buffer.from(String(v).replace(/^0x/i, ""), "hex");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const hash = (alg, ...parts) => {
  const h = createHash(alg);
  for (const p of parts) h.update(p);
  return h.digest();
};
export const sha256hex = (...parts) => hash("sha256", ...parts).toString("hex");

/**
 * Read the fields we need straight from a TDX v4 quote's bytes.
 * This does NOT prove the quote is genuine (no Intel signature check).
 * Offsets: 48-byte header, then the TD report body.
 */
export function parseQuoteLocal(quoteHex) {
  const q = hexBytes(quoteHex);
  if (q.length < 632) throw new Error("quote too short");
  if (q.readUInt16LE(0) !== 4 || q.readUInt32LE(4) !== 0x81) throw new Error("not a TDX v4 quote");
  return {
    tdAttributes: q.subarray(168, 176),
    mrConfigId: q.subarray(232, 280),
    rtMr3: q.subarray(520, 568),
    reportData: q.subarray(568, 632),
  };
}

/** Replay the runtime event log (imr 3 only) into an RTMR3 value. */
export function replayRtmr3(eventLog) {
  let rtmr3 = Buffer.alloc(48);
  for (const event of parse(eventLog)) {
    if (event.imr !== 3) continue;
    const eventType = Buffer.alloc(4);
    eventType.writeUInt32LE(event.event_type);
    const digest = hash(
      "sha384",
      eventType,
      ":",
      Buffer.from(event.event, "utf8"),
      ":",
      hexBytes(event.event_payload ?? "")
    );
    if (event.digest && !hexBytes(event.digest).equals(digest)) {
      throw new Error(`digest mismatch for event ${event.event}`);
    }
    rtmr3 = hash("sha384", rtmr3, digest);
  }
  return rtmr3;
}

/**
 * Compare a report's claims against the quote's contents.
 * Never throws; returns a list of named checks.
 */
export function checkReport(report, nonceHex, quote) {
  const checks = [];
  const guard = (name, fn) => {
    try {
      const ok = !!fn();
      checks.push({ name, ok, detail: "" });
    } catch (e) {
      checks.push({ name, ok: false, detail: e.message });
    }
  };

  guard("td_debug_mode_off", () => (quote.tdAttributes[0] & 1) === 0);

  guard("signer_and_nonce_bound_in_quote", () => {
    const id = hexBytes(report.signing_address);
    if ({ ecdsa: 20, ed25519: 32 }[report.signing_algo] !== id.length) {
      throw new Error("unsupported signing identity");
    }
    const fp = report.tls_cert_fingerprint;
    const bound = fp ? hash("sha256", id, hexBytes(fp)) : Buffer.concat([id, Buffer.alloc(32 - id.length)]);
    return Buffer.from(quote.reportData).equals(Buffer.concat([bound, hexBytes(nonceHex)]));
  });

  guard("echoed_nonce_matches", () => String(report.request_nonce).toLowerCase() === nonceHex.toLowerCase());

  guard("app_compose_matches_mrconfigid", () => {
    const appCompose = parse(report.info.tcb_info).app_compose;
    const expected = Buffer.concat([
      Buffer.from([1]),
      hash("sha256", Buffer.from(appCompose, "utf8")),
      Buffer.alloc(15),
    ]);
    return Buffer.from(quote.mrConfigId).equals(expected);
  });

  guard("event_log_replays_to_rtmr3", () =>
    replayRtmr3(report.event_log).equals(Buffer.from(quote.rtMr3))
  );

  return checks;
}

/**
 * Verify one NEAR report (gateway or model).
 *  online=true : the quote is verified with Intel collateral via dcap-qvl (authenticated).
 *  online=false: bytes are parsed locally only. Checks may pass, but authenticated=false
 *                and ok stays false. Never call an offline result "verified".
 */
export async function verifyReport(report, nonceHex, opts = {}) {
  const { online = true, acceptedTcb = ["UpToDate"] } = opts;
  let quote;
  let authenticated = false;
  let tcbStatus = null;
  const extra = [];

  if (online) {
    const { getCollateralAndVerify } = await import("@phala/dcap-qvl");
    const verified = await getCollateralAndVerify(hexBytes(report.intel_quote));
    tcbStatus = verified.status;
    if (verified.report.type !== "td10") throw new Error("expected a TDX quote");
    const d = verified.report.data;
    quote = { tdAttributes: d.tdAttributes, mrConfigId: d.mrConfigId, rtMr3: d.rtMr3, reportData: d.reportData };
    authenticated = true;
    extra.push({
      name: "tcb_status_accepted",
      ok: acceptedTcb.includes(verified.status),
      detail: `status=${verified.status}`,
    });
  } else {
    quote = parseQuoteLocal(report.intel_quote);
  }

  const checks = [...extra, ...checkReport(report, nonceHex, quote)];
  return {
    ok: authenticated && checks.every((c) => c.ok),
    authenticated,
    tcbStatus,
    signing_address: report.signing_address,
    signing_algo: report.signing_algo,
    attestation_hash: sha256hex(hexBytes(report.intel_quote)),
    checks,
  };
}

/** Send NVIDIA GPU evidence to NRAS and require an overall pass. */
export async function verifyGpu(report, nonceHex) {
  if (!report.nvidia_payload) return { ok: false, detail: "no GPU evidence" };
  const payload = parse(report.nvidia_payload);
  if (String(payload.nonce).toLowerCase() !== nonceHex.toLowerCase()) {
    return { ok: false, detail: "GPU payload nonce mismatch" };
  }
  const r = await fetch("https://nras.attestation.nvidia.com/v3/attest/gpu", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return { ok: false, detail: `NRAS HTTP ${r.status}` };
  const arr = await r.json();
  const jwt = arr?.[0]?.[1];
  if (!jwt) return { ok: false, detail: "no JWT in NRAS response" };
  const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  return { ok: claims["x-nvidia-overall-att-result"] === true, detail: "NRAS verdict (TLS-authenticated)" };
}
