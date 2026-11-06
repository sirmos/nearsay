import test from "node:test";
import assert from "node:assert/strict";
import { authorize, Ledger } from "../src/check.mjs";
import { attacks, legit, buyer } from "../src/corpus.mjs";

for (const c of attacks) {
  test(`blocks: ${c.name}`, () => {
    const { signed, req, ledger, now } = c.build();
    const r = authorize(signed, buyer.publicKey, ledger, req, now);
    assert.equal(r.allow, false);
    assert.ok(r.reasons.includes(c.expect), `expected ${c.expect}, got ${r.reasons}`);
    assert.equal(ledger.spent, c.build().ledger.spent, "a blocked payment must not change the ledger");
  });
}

for (const c of legit) {
  test(`allows: ${c.name}`, () => {
    const { signed, req, ledger, now } = c.build();
    const before = ledger.spent;
    const r = authorize(signed, buyer.publicKey, ledger, req, now);
    assert.equal(r.allow, true, r.reasons.join(","));
    assert.equal(ledger.spent, before + BigInt(req.amount));
  });
}

test("repeated allowed payments eventually hit the total cap", () => {
  const { signed, req, now } = legit[0].build();
  const ledger = new Ledger(0n);
  const results = [];
  for (let i = 0; i < 6; i++) results.push(authorize(signed, buyer.publicKey, ledger, req, now).allow);
  assert.deepEqual(results, [true, true, true, true, true, false]); // 5 x 1,000,000 = cap
});

test("the buyer key is never read from the mandate", () => {
  const { signed, req, ledger, now } = attacks.find((a) => a.name.includes("attacker's own key")).build();
  signed.mandate.buyer_public_key = "anything";
  assert.equal(authorize(signed, buyer.publicKey, ledger, req, now).allow, false);
});
