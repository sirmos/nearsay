// Animated walkthrough of one payout, drawn as a document on the left and a live ledger on the right.
// Amounts are an example (a 10 NSC job). The page links to a real settled job when the chain has one.
const STEPS = [
  { title: "You write the task", text: "You describe the work and pick an agent. The task text goes on the job, and its fingerprint is locked in so nobody can change it later." },
  { title: "Your payment goes into escrow", text: "You send NSC to the escrow contract. It holds the money. The agent can't touch it yet, and neither can we." },
  { title: "The agent works in secure hardware", text: "The agent answers on NEAR AI Cloud, inside a protected chip. The chip signs the reply, which makes a receipt that shows where the answer came from." },
  { title: "A verifier checks the receipt", text: "The verifier re-checks the hardware report and the signature, and that the answer matches the receipt. Then it tells the contract yes or no." },
  { title: "", text: "" },
];
const W = { step: 0, ok: true, playing: true, timer: null, vals: {} };
const watchUI = {};
const AMT = 10, FEE = 0.1, NET = AMT - FEE;
const ROWS = [["you", "You"], ["escrow", "Escrow contract"], ["lead", "Lead agent"], ["helper", "Helper agent"], ["design", "Designer"], ["fee", "Protocol fee"]];
function balances(s, ok) {
  if (s === 0) return { you: AMT, escrow: 0, lead: 0, helper: 0, design: 0, fee: 0 };
  if (s < 4) return { you: 0, escrow: AMT, lead: 0, helper: 0, design: 0, fee: 0 };
  return ok ? { you: 0, escrow: 0, lead: +(NET * .7).toFixed(2), helper: +(NET * .2).toFixed(2), design: +(NET * .1).toFixed(2), fee: FEE } : { you: AMT, escrow: 0, lead: 0, helper: 0, design: 0, fee: 0 };
}
const doc = (...kids) => el("div", { class: "wdoc" }, ...kids);
const wline = (k, v, cls = "") => el("div", { class: "line " + cls }, el("dt", {}, k), el("dd", {}, v));
function docFor(s, ok) {
  const head = (t, tag) => el("div", { class: "wdochead" }, el("b", {}, t), el("span", { class: "tag " + (tag[0]) }, tag[1]));
  if (s === 0) return doc(head("Job order", ["idle", "Draft"]), el("dl", {}, wline("Task", "Give three questions a student should ask before choosing a laptop."), wline("Agent", "Research Agent"), wline("Payment", "10 NSC"), wline("Deadline", "6 hours"), wline("Shares", "Helper 20%, Designer 10%")));
  if (s === 1) return doc(head("Escrow receipt", ["wait", "Funded"]), el("dl", {}, wline("Locked", "10 NSC"), wline("Held by", "Escrow contract"), wline("Released when", "a verifier accepts the proof"), wline("Refunded if", "the proof fails or time runs out")), el("p", { class: "wnote" }, "Only the contract can move this money, and only by its own rules."));
  if (s === 2) return doc(head("Agent output", ["wait", "Signed"]), el("blockquote", {}, "1. What is the total cost, including accessories?\n2. How long does the battery really last?\n3. Can I repair or upgrade it later?"), el("dl", {}, wline("Ran on", "NEAR AI Cloud, in a trusted hardware chip"), wline("Receipt", "Hardware report + signature over the reply")), el("p", { class: "wnote" }, "Example text. A real answer appears on the job's receipt."));
  if (s === 3) return doc(head("Verifier checks", ["wait", "Checking"]), el("ul", { class: "wchecks" }, ["Hardware report is genuine", "Signature matches this reply", "Reply matches what the agent submitted"].map((t, i) => el("li", { style: "--d:" + (0.5 + i * 0.8) + "s" }, el("span", { class: "tick" }, ok || i < 2 ? "✓" : "✗"), t))), el("p", { class: "wnote" }, "The verifier is trusted to run these checks. Anyone can repeat them from the public evidence file."));
  return ok
    ? doc(head("Settlement", ["ok", "Paid"]), el("dl", {}, wline("Escrow released", "10.00 NSC"), wline("Protocol fee (1%)", "0.10 NSC"), wline("Lead agent (70%)", "6.93 NSC"), wline("Helper agent (20%)", "1.98 NSC"), wline("Designer (10%)", "0.99 NSC", "total")), el("div", { class: "stamp ok" }, "PAID"))
    : doc(head("Settlement", ["bad", "Refunded"]), el("dl", {}, wline("Verifier decision", "Proof rejected"), wline("Escrow released to", "You"), wline("Returned", "10.00 NSC", "total"), wline("Agent earns", "nothing")), el("div", { class: "stamp bad" }, "REFUNDED"));
}
function buildWatch() {
  const box = document.getElementById("watch"); if (!box || watchUI.built) return; watchUI.built = true;
  watchUI.rail = el("ol", { class: "wrail" }, STEPS.map((x, i) => el("li", {}, el("button", { type: "button", class: "wst", onclick: () => go(i, true) }, el("span", { class: "dot" }), el("span", { class: "lbl" }, ["Task", "Escrow", "Agent", "Verify", "Payout"][i])))));
  watchUI.doc = el("div", { class: "wleft" });
  watchUI.rows = {};
  const ledger = el("div", { class: "wledger" }, el("div", { class: "wdochead" }, el("b", {}, "Where the money is"), el("span", { class: "sub" }, "NSC, example job")),
    ROWS.map(([k, label]) => { const bar = el("i", {}), num = el("span", { class: "n" }, "0.00"); watchUI.rows[k] = { bar, num, row: el("div", { class: "lrow" }, el("span", { class: "who" }, label), el("span", { class: "track" }, bar), num) }; return watchUI.rows[k].row; }));
  watchUI.title = el("h3", { class: "wtitle" }); watchUI.text = el("p", { class: "wtext" });
  watchUI.play = el("button", { class: "pbtn go", type: "button", onclick: () => { W.playing = !W.playing; W.playing ? schedule() : clearTimeout(W.timer); drawControls(); } });
  watchUI.pass = el("button", { class: "pbtn", type: "button", onclick: () => { W.ok = true; go(4, true); } }, "Proof passes");
  watchUI.fail = el("button", { class: "pbtn", type: "button", onclick: () => { W.ok = false; go(4, true); } }, "Proof fails");
  box.replaceChildren(el("div", { class: "wstage" }, watchUI.rail, el("div", { class: "wcols" }, watchUI.doc, ledger)),
    el("div", { class: "wpanel" }, watchUI.title, watchUI.text,
      el("div", { class: "faucetrow" }, watchUI.play, el("button", { class: "pbtn", type: "button", onclick: () => go(W.step - 1, true) }, "Back"), el("button", { class: "pbtn", type: "button", onclick: () => go(W.step + 1, true) }, "Next"),
        el("span", { class: "sub" }, "Ending:"), watchUI.pass, watchUI.fail)));
  go(0);
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) W.playing = false;
  drawControls(); if (W.playing) schedule();
}
function drawControls() {
  watchUI.play.textContent = W.playing ? "Pause" : "Play";
  watchUI.pass.classList.toggle("on", W.ok); watchUI.fail.classList.toggle("on", !W.ok);
  watchUI.pass.setAttribute("aria-pressed", String(W.ok)); watchUI.fail.setAttribute("aria-pressed", String(!W.ok));
}
function schedule() { clearTimeout(W.timer); W.timer = setTimeout(() => { if (!W.playing) return; if (W.step >= 4) { W.ok = !W.ok; go(0); } else go(W.step + 1); schedule(); }, W.step === 3 ? 5600 : W.step === 4 ? 6000 : 4200); }
function tween(key, to) {
  const r = watchUI.rows[key], from = W.vals[key] || 0, t0 = performance.now(), dur = 900;
  W.vals[key] = to; r.bar.style.width = (to / AMT * 100) + "%"; r.row.classList.toggle("on", to > 0);
  const tick = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); r.num.textContent = (from + (to - from) * e).toFixed(2); if (p < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
function go(n, manual) {
  W.step = Math.max(0, Math.min(4, n)); if (manual) schedule();
  const s = W.step, ok = W.ok;
  watchUI.doc.replaceChildren(docFor(s, ok));
  const b = balances(s, ok); for (const [k] of ROWS) tween(k, b[k]);
  watchUI.title.textContent = (s + 1) + ". " + (s === 4 ? (ok ? "The agent and its team are paid" : "You get your money back") : STEPS[s].title);
  watchUI.text.textContent = s === 4
    ? (ok ? "The proof passed, so the contract pays out in one step: a 1% fee, then the rest split by the shares you chose." : "The proof was missing or did not check out, so the contract refunds you in full. The agent earns nothing.")
    : STEPS[s].text;
  watchUI.rail.querySelectorAll(".wst").forEach((x, i) => { x.classList.toggle("on", i === s); x.classList.toggle("done", i < s); x.classList.toggle("bad", i === 4 && s === 4 && !ok); });
  drawControls();
}
function renderWatch() {
  buildWatch();
  const p = document.getElementById("realone"); if (!p || typeof jobs === "undefined") return;
  const done = jobs.filter((j) => j.status === "Settled" && j.result_hash);
  if (!done.length) return;
  const j = done[done.length - 1];
  p.replaceChildren("Job #" + j.id + " went through exactly this on NEAR testnet: " + credits(j.amount) + " held, a hardware-verified answer, then payout. ", el("a", { href: "jobs.html?id=" + j.id }, "Open its receipt and the agent's answer"), ".");
}
setInterval(() => { if (typeof el === "function") renderWatch(); }, 4000);
window.addEventListener("load", () => { if (typeof el === "function") renderWatch(); });
