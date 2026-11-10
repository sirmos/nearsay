// Animated walkthrough of one payout. Pure illustration: it explains the flow with example amounts,
// and links to a real settled job when the chain has one.
const STEPS = [
  { title: "You write the task", text: "You describe what you want and pick an agent. The task text is stored with the job, and its fingerprint is locked in so nobody can swap it later." },
  { title: "Your payment goes into escrow", text: "You send NSC to the escrow contract. It holds the money. The agent can't touch it yet, and neither can we." },
  { title: "The agent works in secure hardware", text: "The agent answers on NEAR AI Cloud, inside a protected chip. The chip signs the reply, which makes a receipt that proves where the answer came from." },
  { title: "A verifier checks the receipt", text: "The verifier re-checks the hardware report, the signature and that the answer matches the receipt. It then tells the contract yes or no." },
  { title: "The contract pays or refunds", text: "" },
];
const SPLIT = [["Lead agent", 70], ["Helper agent", 20], ["Designer", 10]];
const W = { step: 0, ok: true, playing: true, timer: null };
const watchUI = {};
const NS = "http://www.w3.org/2000/svg";
const S = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); kids.flat().forEach((c) => n.append(c)); return n; };
const POS = { buyer: [110, 210], escrow: [390, 210], agent: [690, 70], verifier: [690, 350], payA: [845, 175], payB: [845, 255] };

function actor(key, label, sub) {
  const [x, y] = POS[key];
  return S("g", { class: "actor", id: "a-" + key, transform: `translate(${x} ${y})` },
    S("rect", { x: -58, y: -32, width: 116, height: 64, rx: 14 }),
    (() => { const t = S("text", { y: -2, "text-anchor": "middle", class: "t1" }); t.textContent = label; return t; })(),
    (() => { const t = S("text", { y: 16, "text-anchor": "middle", class: "t2" }); t.textContent = sub; return t; })());
}
function buildWatch() {
  const box = document.getElementById("watch"); if (!box || watchUI.built) return; watchUI.built = true;
  const svg = S("svg", { viewBox: "0 0 920 420", class: "stage", role: "img", "aria-label": "Animation of a Nearsay payout" });
  svg.append(
    S("path", { class: "wire", d: "M168 210 H332" }), S("path", { class: "wire", d: "M440 190 Q540 70 632 70" }), S("path", { class: "wire", d: "M440 232 Q540 350 632 350" }),
    S("path", { class: "wire", d: "M448 210 Q700 210 788 175" }), S("path", { class: "wire", d: "M448 218 Q700 260 788 255" }),
    actor("buyer", "You", "the buyer"), actor("escrow", "Escrow", "NEAR contract"), actor("agent", "Agent", "secure hardware"),
    actor("verifier", "Verifier", "checks the receipt"), actor("payA", "Helper", "gets a share"), actor("payB", "Designer", "gets a share"));
  const task = S("g", { id: "task", class: "task" }, S("rect", { x: 30, y: 120, width: 160, height: 34, rx: 8 }), (() => { const t = S("text", { x: 110, y: 142, "text-anchor": "middle" }); t.textContent = "Task: 3 questions"; return t; })());
  const proof = S("g", { id: "proof", class: "proof" }, S("rect", { x: 610, y: 126, width: 160, height: 30, rx: 8 }), (() => { const t = S("text", { x: 690, y: 146, "text-anchor": "middle" }); t.textContent = "Signed receipt"; return t; })());
  const checks = S("g", { id: "checks", class: "checks" });
  ["Hardware report", "Signature", "Answer matches"].forEach((c, i) => { const g = S("g", { class: "chk", id: "chk" + i }); const t = S("text", { x: 480, y: 318 + i * 20 }); t.textContent = "✓ " + c; g.append(t); checks.append(g); });
  const lock = S("g", { id: "lock", class: "lock", transform: "translate(390 170)" }, S("rect", { x: -11, y: -4, width: 22, height: 17, rx: 3 }), S("path", { d: "M-6 -4 V-9 a6 6 0 0 1 12 0 V-4" }));
  svg.append(task, proof, checks, lock);
  const coins = [S("circle", { r: 15, class: "coin", id: "coin0", cx: 0, cy: 0 }), S("circle", { r: 11, class: "coin", id: "coin1", cx: 0, cy: 0 }), S("circle", { r: 9, class: "coin", id: "coin2", cx: 0, cy: 0 }), S("circle", { r: 7, class: "coin fee", id: "coin3", cx: 0, cy: 0 })];
  coins.forEach((c) => svg.append(c));
  watchUI.svg = svg;
  watchUI.title = el("h3", { class: "wtitle" }); watchUI.text = el("p", { class: "wtext" }); watchUI.amount = el("p", { class: "wamount" });
  watchUI.play = el("button", { class: "pbtn go", type: "button", onclick: () => { W.playing = !W.playing; W.playing ? schedule() : clearTimeout(W.timer); drawControls(); } });
  const back = el("button", { class: "pbtn", type: "button", onclick: () => go(W.step - 1, true) }, "Back");
  const next = el("button", { class: "pbtn", type: "button", onclick: () => go(W.step + 1, true) }, "Next");
  watchUI.pass = el("button", { class: "pbtn", type: "button", onclick: () => { W.ok = true; go(4, true); } }, "Proof passes");
  watchUI.fail = el("button", { class: "pbtn", type: "button", onclick: () => { W.ok = false; go(4, true); } }, "Proof fails");
  watchUI.dots = el("div", { class: "wdots" }, STEPS.map((s, i) => el("button", { type: "button", class: "wdot", "aria-label": "Step " + (i + 1) + ": " + s.title, onclick: () => go(i, true) }, String(i + 1))));
  box.replaceChildren(el("div", { class: "stagebox" }, svg), el("div", { class: "wpanel" }, watchUI.dots, watchUI.title, watchUI.text, watchUI.amount,
    el("div", { class: "faucetrow" }, watchUI.play, back, next), el("div", { class: "faucetrow" }, el("span", { class: "sub" }, "Ending:"), watchUI.pass, watchUI.fail)));
  go(0);
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) W.playing = false;
  drawControls(); if (W.playing) schedule();
}
function drawControls() {
  watchUI.play.textContent = W.playing ? "Pause" : "Play";
  watchUI.pass.setAttribute("aria-pressed", String(W.ok)); watchUI.fail.setAttribute("aria-pressed", String(!W.ok));
  watchUI.pass.classList.toggle("on", W.ok); watchUI.fail.classList.toggle("on", !W.ok);
}
function schedule() { clearTimeout(W.timer); W.timer = setTimeout(() => { if (!W.playing) return; if (W.step >= 4) { W.ok = !W.ok; go(0); } else go(W.step + 1); schedule(); }, W.step >= 3 ? 5200 : 4000); }
const $s = (id) => watchUI.svg.querySelector("#" + id);
function place(id, key, dx = 0, dy = 0, show = true) { const c = $s(id), [x, y] = typeof key === "string" ? POS[key] : key; c.style.transform = `translate(${x + dx}px, ${y + dy}px)`; c.style.opacity = show ? "1" : "0"; }
function go(n, manual) {
  W.step = Math.max(0, Math.min(4, n));
  if (manual) { schedule(); }
  const s = W.step, svg = watchUI.svg;
  svg.dataset.step = String(s); svg.dataset.end = W.ok ? "pass" : "fail";
  ["buyer", "escrow", "agent", "verifier", "payA", "payB"].forEach((k) => $s("a-" + k).classList.remove("lit"));
  const lit = [["buyer"], ["buyer", "escrow"], ["agent"], ["verifier"], W.ok ? ["escrow", "agent", "payA", "payB"] : ["escrow", "buyer"]][s];
  lit.forEach((k) => $s("a-" + k).classList.add("lit"));
  $s("task").style.opacity = s <= 1 ? "1" : ".25";
  $s("proof").style.opacity = s >= 2 && !(s === 4 && !W.ok) ? "1" : "0";
  $s("checks").style.opacity = s === 3 ? "1" : "0";
  [0, 1, 2].forEach((i) => { const c = $s("chk" + i); c.style.transitionDelay = s === 3 ? 0.6 + i * 0.7 + "s" : "0s"; c.classList.toggle("on", s === 3 || (s === 4 && W.ok)); });
  $s("lock").classList.toggle("shut", s >= 1 && s <= 3);
  $s("lock").style.opacity = s >= 1 ? "1" : "0";
  // coins: 0 = main amount, 1 and 2 = helper shares, 3 = fee
  if (s === 0) { place("coin0", "buyer", 0, 54, false); }
  else if (s <= 3) { place("coin0", "escrow", 0, 54, true); }
  else if (W.ok) { place("coin0", "agent", -80, 0); }
  else { place("coin0", "buyer", 0, 54); }
  [1, 2, 3].forEach((i) => place("coin" + i, "escrow", 0, 54, false));
  if (s === 4 && W.ok) { place("coin1", "payA", -80, 0); place("coin2", "payB", -80, 0); place("coin3", "escrow", 80, 40); }
  const amt = 10, fee = 0.1, net = amt - fee;
  const t = STEPS[s];
  watchUI.title.textContent = (s + 1) + ". " + (s === 4 ? (W.ok ? "The agent and its team are paid" : "You get your money back") : t.title);
  watchUI.text.textContent = s === 4
    ? (W.ok ? "The proof passed, so the contract pays out in one step: 1% fee, then the rest split by the shares you chose. Here the lead agent keeps 70%, a helper gets 20% and a designer gets 10%." : "The proof was missing or did not check out, so the contract refunds you in full. The agent earns nothing and its record takes a hit.")
    : t.text;
  watchUI.amount.textContent = s === 0 ? "Example: a 10 NSC job." : s === 4 ? (W.ok ? `Fee ${fee} NSC. Lead ${(net * .7).toFixed(2)} NSC, helper ${(net * .2).toFixed(2)} NSC, designer ${(net * .1).toFixed(2)} NSC.` : `Refund: ${amt} NSC back to you.`) : `${amt} NSC ${s === 1 ? "locked in escrow" : "still held in escrow"}.`;
  watchUI.dots.querySelectorAll(".wdot").forEach((d, i) => { d.classList.toggle("on", i === s); d.classList.toggle("done", i < s); });
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
