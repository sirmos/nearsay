// Hire an agent: describe a task, pick an agent, lock the payment in escrow from your wallet.
// Two wallet approvals: create the job, then fund it. The job runner (autopilot) does the rest.
const AGENTS = [
  { key: "research", name: "Research Agent", seller: () => CFG.accounts.seller, attested: true,
    blurb: "Answers on NEAR AI Cloud inside secure hardware and returns a proof the verifier can check.",
    wrap: (t) => "You are a careful research agent. Answer in at most 120 words, plainly and without hype.\n\nTask: " + t },
  { key: "copy", name: "Copy Agent", seller: () => CFG.accounts.seller, attested: true,
    blurb: "Writes short, clear copy with the same hardware proof.",
    wrap: (t) => "You are a copywriter. Reply with just the copy, at most 80 words.\n\nBrief: " + t },
  { key: "unproven", name: "Unproven Agent", seller: () => CFG.accounts.liar, attested: false,
    blurb: "Safety-net demo. It answers with no hardware proof, so the verifier rejects the work and you get a full refund.",
    wrap: (t) => "You are a careful research agent. Answer in at most 120 words, plainly and without hype.\n\nTask: " + t },
];
const EXAMPLES = ["Explain in two sentences why escrow protects a buyer.", "Write a friendly one-line apology for a late delivery.", "Give three questions a student should ask before choosing a laptop."];
const hire = { agent: "research", amount: 5, hours: 6, splits: [], jobId: null, step: "idle", note: "" };
const hireUI = {};
const sha256Hex = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const agentOf = () => AGENTS.find((a) => a.key === hire.agent);
const taskText = () => (hireUI.task ? hireUI.task.value.trim() : "");
const fullPrompt = () => agentOf().wrap(taskText());
const rawAmount = () => BigInt(Math.round(Number(hire.amount) * 1e6));

function readSplits() {
  return [...document.querySelectorAll(".splitrow")].map((r) => ({ account: r.querySelector("input.sacct").value.trim().toLowerCase(), pct: Number(r.querySelector("input.spct").value) })).filter((s) => s.account || s.pct);
}
function problems() {
  const out = [], t = taskText();
  if (t.length < 10) out.push("Describe the task in at least 10 characters.");
  if (new TextEncoder().encode(fullPrompt()).length > 1000) out.push("The task is too long. Keep it under about 700 characters.");
  if (!(Number(hire.amount) >= 1 && Number(hire.amount) <= 20)) out.push("Choose an amount from 1 to 20 NSC.");
  const sp = readSplits();
  let total = 0;
  for (const s of sp) {
    if (!/^[a-z0-9._-]{2,64}\.(testnet|near)$/.test(s.account)) out.push("Each payee needs a full account name like name.testnet.");
    else if (s.account === me || s.account === agentOf().seller()) out.push("A payee must differ from you and from the lead agent.");
    if (!(s.pct >= 1 && s.pct <= 90)) out.push("Each share must be between 1% and 90%.");
    total += s.pct || 0;
  }
  if (new Set(sp.map((s) => s.account)).size !== sp.length) out.push("Each payee can appear only once.");
  if (total > 90) out.push("Shares can add up to at most 90%, so the lead agent keeps a part.");
  if (sp.length > 4) out.push("At most 4 extra payees.");
  return [...new Set(out)];
}
const splitsArg = () => readSplits().map((s) => ({ account: s.account, bps: Math.round(s.pct * 100) }));

function addSplitRow(account = "", pct = "") {
  const row = el("div", { class: "splitrow" },
    el("input", { class: "sacct", type: "text", placeholder: "payee.testnet", value: account, autocomplete: "off", spellcheck: "false", "aria-label": "Payee account" }),
    el("input", { class: "spct", type: "number", min: "1", max: "90", placeholder: "%", value: String(pct), "aria-label": "Share in percent" }),
    el("button", { class: "pbtn", type: "button", "aria-label": "Remove payee", onclick: () => { row.remove(); renderHire(); } }, "Remove"));
  row.querySelectorAll("input").forEach((i) => i.addEventListener("input", renderHire));
  hireUI.splits.append(row);
}
function buildHire() {
  const box = document.getElementById("hireform"); if (!box || hireUI.built) return;
  hireUI.built = true;
  hireUI.task = el("textarea", { id: "task", maxlength: "600", placeholder: "For example: " + EXAMPLES[0], "aria-label": "Task" });
  hireUI.task.addEventListener("input", renderHire);
  const chips = el("div", { class: "chips" }, EXAMPLES.map((t) => el("button", { type: "button", class: "chip", onclick: () => { hireUI.task.value = t; renderHire(); } }, t)));
  const cards = el("div", { class: "agentcards" }, AGENTS.map((a) => {
    const input = el("input", { type: "radio", name: "agent", value: a.key, checked: a.key === hire.agent ? "" : null });
    input.addEventListener("change", () => { hire.agent = a.key; renderHire(); });
    return el("label", { class: "agentcard" }, input, el("span", { class: "acbody" }, el("b", {}, a.name), el("span", { class: "tag " + (a.attested ? "ok" : "bad") }, a.attested ? "Hardware proof" : "No proof"), el("small", {}, a.blurb)));
  }));
  hireUI.amount = el("input", { type: "number", min: "1", max: "20", step: "1", value: String(hire.amount), "aria-label": "Amount in NSC" });
  hireUI.amount.addEventListener("input", () => { hire.amount = hireUI.amount.value; renderHire(); });
  hireUI.hours = el("select", { "aria-label": "Deadline" }, [[2, "2 hours"], [6, "6 hours"], [24, "24 hours"]].map(([h, l]) => el("option", { value: String(h), selected: h === hire.hours ? "" : null }, l)));
  hireUI.hours.addEventListener("change", () => { hire.hours = Number(hireUI.hours.value); renderHire(); });
  const pay = el("select", { "aria-label": "Pay with" },
    el("option", { value: "nsc" }, "NSC on NEAR testnet"),
    el("option", { value: "usdc", disabled: "" }, "USDC from any chain via NEAR Intents (next)"),
    el("option", { value: "eth", disabled: "" }, "ETH from any chain via NEAR Intents (next)"));
  hireUI.splits = el("div", { class: "splitrows" });
  hireUI.summary = el("div", { class: "hsummary" });
  hireUI.status = el("div", { class: "hstatus", role: "status" });
  hireUI.action = el("div", { class: "faucetrow" });
  hireUI.mine = el("div", {});
  box.append(
    el("div", { class: "hgrid" },
      el("div", { class: "hcol" },
        el("div", { class: "fstep" }, el("h3", {}, "1. Describe the task"), hireUI.task, chips),
        el("div", { class: "fstep" }, el("h3", {}, "2. Choose an agent"), cards),
        el("div", { class: "fstep" }, el("h3", {}, "3. Set the payment"),
          el("div", { class: "frow" }, el("label", {}, "Amount (NSC)", hireUI.amount), el("label", {}, "Deadline", hireUI.hours), el("label", {}, "Pay with", pay)),
          el("p", { class: "sub" }, "Today the escrow runs on NSC test credits on NEAR testnet. Paying from other chains through NEAR Intents is next on the roadmap, not live yet."),
          el("h4", {}, "Share the payout with other agents (optional)"),
          el("p", { class: "sub" }, "When the proof checks out, the payout is split in one step. The lead agent keeps whatever is left."),
          hireUI.splits,
          el("div", { class: "faucetrow" },
            el("button", { class: "pbtn", type: "button", onclick: () => { if (hireUI.splits.children.length < 4) addSplitRow(); } }, "Add a payee"),
            el("button", { class: "pbtn", type: "button", onclick: () => { hireUI.splits.replaceChildren(); addSplitRow(CFG.accounts.buyer, 20); addSplitRow(CFG.accounts.verifier, 10); renderHire(); } }, "Try an example team")))),
      el("div", { class: "hcol" },
        el("div", { class: "fstep sticky" }, el("h3", {}, "4. Review and fund"), hireUI.summary, hireUI.status, hireUI.action),
        hireUI.mine)));
}
function renderHire() {
  buildHire();
  if (!hireUI.built) return;
  const errs = problems(), a = agentOf();
  const amt = rawAmount(), fee = (amt * CFG.feeBps) / 10000n, payout = amt - fee;
  const sp = readSplits();
  let given = 0n; const lines = sp.filter((s) => s.pct > 0).map((s) => { const share = (payout * BigInt(Math.round(s.pct * 100))) / 10000n; given += share; return [s.account, share]; });
  hireUI.summary.replaceChildren(el("dl", {},
    el("div", { class: "line" }, el("dt", {}, "Agent"), el("dd", {}, a.name)),
    el("div", { class: "line" }, el("dt", {}, "Locked in escrow"), el("dd", {}, credits(String(amt)))),
    el("div", { class: "line" }, el("dt", {}, "Fee (1%)"), el("dd", {}, credits(String(fee)))),
    ...lines.map(([acc, share]) => el("div", { class: "line" }, el("dt", {}, short(acc, 12)), el("dd", {}, credits(String(share))))),
    el("div", { class: "line total" }, el("dt", {}, "Lead agent gets"), el("dd", {}, credits(String(payout - given)))),
    el("div", { class: "line" }, el("dt", {}, "If the proof fails"), el("dd", {}, "You get " + credits(String(amt)) + " back"))));
  if (me && !hire.jobId) { const o = jobs.filter((x) => x.buyer === me && x.status === "Open"); if (o.length) hire.jobId = o[o.length - 1].id; }
  const j = hire.jobId ? jobs.find((x) => x.id === hire.jobId) : null;
  if (j && j.status !== "Open") { pickedJob = j.id; }
  const st = [];
  if (!me) st.push(el("p", { class: "sub" }, "Sign in with a funded testnet wallet to hire an agent. New here? ", el("a", { href: "arena.html#join" }, "Get set up in two minutes"), "."));
  else if (myBalance !== null && BigInt(myBalance) < amt) st.push(el("p", { class: "flash err" }, "You have " + credits(myBalance) + ". Get free test credits first."));
  errs.forEach((e) => st.push(el("p", { class: "flash err" }, e)));
  if (j) {
    const m = { Open: "Job created. Fund the escrow to start the work.", Funded: "Funded. The agent is working. This usually takes one to three minutes.", Submitted: "The agent answered. The verifier is checking the proof.", Settled: "Verified. The agent was paid.", Refunded: "The proof did not check out, so you were refunded." }[j.status];
    st.push(el("p", { class: "flash " + (j.status === "Refunded" ? "err" : "ok") }, "Job #" + j.id + ": " + m, " ", el("a", { href: "jobs.html?id=" + j.id }, "Open the receipt")));
  }
  if (flashMsg) st.push(el("p", { class: "flash " + flashMsg.kind }, flashMsg.text));
  hireUI.status.replaceChildren(...st);
  const acts = [];
  if (!me) acts.push(el("button", { class: "pbtn go", type: "button", onclick: connect }, "Sign in"));
  else if (myBalance !== null && BigInt(myBalance) === 0n) acts.push(el("button", { class: "pbtn go", type: "button", onclick: getCredits, disabled: busy ? "" : null }, "Get test credits"));
  else if (j && j.status === "Open") acts.push(el("button", { class: "pbtn go", type: "button", onclick: () => fundJob(j), disabled: busy ? "" : null }, "Fund the escrow"));
  else if (!j || j.status === "Settled" || j.status === "Refunded") acts.push(el("button", { class: "pbtn go", type: "button", disabled: errs.length || busy ? "" : null, onclick: createJob }, "Create the job"));
  if (j && (j.status === "Settled" || j.status === "Refunded")) acts.push(el("button", { class: "pbtn", type: "button", onclick: () => { hire.jobId = null; renderAll(); } }, "Hire again"));
  hireUI.action.replaceChildren(...acts);
  const mine = me ? jobs.filter((x) => x.buyer === me && x.status === "Open" && x.id !== hire.jobId) : [];
  hireUI.mine.replaceChildren(...(mine.length ? [el("div", { class: "fstep" }, el("h3", {}, "Your unfunded jobs"), el("p", { class: "sub" }, "These were created but never funded. Fund them to start the work."),
    ...mine.map((x) => el("div", { class: "faucetrow" }, el("span", {}, "Job #" + x.id + ", " + credits(x.amount)), el("button", { class: "pbtn go", type: "button", disabled: busy ? "" : null, onclick: () => fundJob(x) }, "Fund the escrow"))))] : []));
}
async function createJob() {
  if (!me) return connect();
  if (problems().length) return renderHire();
  const text = fullPrompt(), hash = await sha256Hex(text), a = agentOf();
  const args = { seller: a.seller(), token: CFG.token, amount: String(rawAmount()), spec_hash: hash, deadline_ms: Date.now() + hire.hours * 3600000, spec_text: text, splits: splitsArg() };
  await send(CFG.escrow, [["create_job", args, 40n * 10n ** 12n]], "Job created. Next, fund the escrow.");
  if (flashMsg && flashMsg.kind === "err") return renderHire();
  for (let i = 0; i < 8 && !hire.jobId; i++) {
    await new Promise((r) => setTimeout(r, i ? 2500 : 1500));
    await refresh();
    const mine = jobs.filter((x) => x.buyer === me && x.spec_hash === hash && x.status === "Open");
    if (mine.length) hire.jobId = mine[mine.length - 1].id;
  }
  renderAll();
}
async function fundJob(j) {
  hire.jobId = j.id;
  await send(CFG.token, [["ft_transfer_call", { receiver_id: CFG.escrow, amount: String(j.amount), msg: String(j.id) }, STAKE_GAS, "1"]], "Escrow funded. The agent starts now.");
  for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 2500)); await refresh(); const now = jobs.find((x) => x.id === j.id); if (now && now.status !== "Open") break; }
  renderAll();
}
