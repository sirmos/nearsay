import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkReport, parseQuoteLocal, replayRtmr3, verifyReport } from "../src/attestation.mjs";

const sha = (alg, ...p) => { const h = createHash(alg); p.forEach((x) => h.update(x)); return h.digest(); };

// Build a synthetic but self-consistent report + quote so the checks can be exercised offline.
function makeFake({ nonce = "ab".repeat(32), addr = "3b753b4406613c5e70ae640508632b600424fa0c" } = {}) {
  const appCompose = '{"name":"demo"}';
  const events = [{ imr: 3, event_type: 134217729, event: "app-id", event_payload: "abcd" }];
  const report = {
    signing_address: "0x" + addr,
    signing_algo: "ecdsa",
    request_nonce: nonce,
    info: { tcb_info: { app_compose: appCompose } },
    event_log: JSON.stringify(events),
  };
  const rtmr3 = replayRtmr3(report.event_log);
  const q = Buffer.alloc(632 + 4);
  q.writeUInt16LE(4, 0);
  q.writeUInt32LE(0x81, 4);
  Buffer.concat([Buffer.from([1]), sha("sha256", Buffer.from(appCompose)), Buffer.alloc(15)]).copy(q, 232);
  rtmr3.copy(q, 520);
  Buffer.concat([Buffer.from(addr, "hex"), Buffer.alloc(12), Buffer.from(nonce, "hex")]).copy(q, 568);
  report.intel_quote = q.toString("hex");
  return { report, nonce };
}
const run = (report, nonce) => checkReport(report, nonce, parseQuoteLocal(report.intel_quote));
const failing = (checks) => checks.filter((c) => !c.ok).map((c) => c.name);

test("consistent evidence passes every structural check", () => {
  const { report, nonce } = makeFake();
  assert.deepEqual(failing(run(report, nonce)), []);
});

test("offline mode never reports verified", async () => {
  const { report, nonce } = makeFake();
  const r = await verifyReport(report, nonce, { online: false });
  assert.equal(r.authenticated, false);
  assert.equal(r.ok, false);
  assert.deepEqual(failing(r.checks), []);
});

test("wrong nonce is rejected", () => {
  const { report, nonce } = makeFake();
  assert.ok(failing(run(report, "cd".repeat(32))).includes("signer_and_nonce_bound_in_quote"));
  assert.ok(failing(run(report, "cd".repeat(32))).includes("echoed_nonce_matches"));
  assert.deepEqual(failing(run(report, nonce)), []);
});

test("a different signing address is rejected", () => {
  const { report, nonce } = makeFake();
  report.signing_address = "0x" + "11".repeat(20);
  assert.ok(failing(run(report, nonce)).includes("signer_and_nonce_bound_in_quote"));
});

test("tampered app_compose is rejected", () => {
  const { report, nonce } = makeFake();
  report.info.tcb_info.app_compose = '{"name":"evil"}';
  assert.ok(failing(run(report, nonce)).includes("app_compose_matches_mrconfigid"));
});

test("tampered event log is rejected", () => {
  const { report, nonce } = makeFake();
  const ev = JSON.parse(report.event_log);
  ev[0].event_payload = "ffff";
  report.event_log = JSON.stringify(ev);
  assert.ok(failing(run(report, nonce)).includes("event_log_replays_to_rtmr3"));
});

test("debug mode quote is rejected", () => {
  const { report, nonce } = makeFake();
  const q = Buffer.from(report.intel_quote, "hex");
  q[168] = 1;
  report.intel_quote = q.toString("hex");
  assert.ok(failing(run(report, nonce)).includes("td_debug_mode_off"));
});

test("non-TDX bytes are refused", () => {
  assert.throws(() => parseQuoteLocal("00".repeat(700)));
});
