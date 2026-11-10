
const acct = (n) => NS_PREFIX + "-" + n + ".testnet";
const CFG = {
  rpc: "https://rpc.testnet.near.org",
  escrow: acct("escrow"),
  arena: acct("arena"),
  token: acct("credits"),
  pass: acct("pass"),
  accounts: { buyer: acct("buyer"), seller: acct("seller"), liar: acct("liar"), verifier: acct("verifier") },
  decimals: 6,
  feeBps: 100n,
  explorer: "https://testnet.nearblocks.io/address/",
  evidenceBase: "https://github.com/sirmos/nearsay/blob/main/evidence/",
  refreshMs: 12000,
};

// ---------- state ----------
let pickedJob = (() => { try { return Number(new URLSearchParams(location.search).get("id")) || null; } catch (e) { return null; } })(), shownJob = null;
const finalJobs = new Map();    // settled/refunded jobs never change: cache them
const finalRounds = new Map();  // settled/voided rounds never change
let jobs = [], rounds = [], reps = [], bals = [];
let failures = 0, hasData = false;

// ---------- chain access (read-only, with retry) ----------
async function rpcView(account, method, args = {}, tries = 6) {
  let lastErr;
  for (let t = 0; t < tries; t++) {
    try {
      const res = await fetch(RPCS[rpcIdx % RPCS.length], {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query",
          params: { request_type: "call_function", finality: "final", account_id: account,
            method_name: method, args_base64: btoa(JSON.stringify(args)) } }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      if (j.error) throw new Error(j.error.data || j.error.message || "RPC error");
      if (j.result && j.result.error) throw new Error(j.result.error);
      return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
    } catch (e) {
      lastErr = e; rpcIdx++;
      await new Promise((r) => setTimeout(r, 400 * (t + 1)));
    }
  }
  throw lastErr;
}
const RPCS = ["https://test.rpc.fastnear.com", CFG.rpc, "https://rpc.testnet.fastnear.com"];
let rpcIdx = 0;
const isFinal = (s) => s === "Settled" || s === "Refunded" || s === "Voided";
// Read ids 1..n. Cached final items are not refetched; only open items and the next id are.
async function readList(account, method, idKey, cache) {
  const out = [];
  for (let i = 1; ; i++) {
    if (cache.has(i)) { out.push(cache.get(i)); continue; }
    // fetch this id and, in parallel, the next few, so a long list needs few round trips
    const ids = [i, i + 1, i + 2, i + 3];
    const got = await Promise.all(ids.map((id) => rpcView(account, method, { [idKey]: id })));
    let ended = false;
    got.forEach((item, k) => {
      if (ended) return;
      if (!item) { ended = true; return; }
      if (isFinal(item.status)) cache.set(ids[k], item);
      out.push(item);
    });
    if (ended) return out;
    i += ids.length - 1;
    if (i > 400) return out;
  }
}

// ---------- DOM helpers (chain data is untrusted: never innerHTML) ----------
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
}
const $ = (id) => document.getElementById(id);
const PAGE = document.body.dataset.page || "home";
const put = (id, ...nodes) => { const n = $(id); if (n) n.replaceChildren(...nodes); };
const short = (s, n = 8) => (!s ? "none" : s.length > n * 2 + 1 ? s.slice(0, n) + "…" + s.slice(-4) : s);
const nameOf = (a) => { const e = Object.entries(CFG.accounts).find(([, v]) => v === a); return e ? e[0] : short(a, 12); };
const link = (a, text) => el("a", { href: CFG.explorer + encodeURIComponent(a), target: "_blank", rel: "noopener" }, text || nameOf(a));
const fmt = (raw) => (Number(BigInt(raw)) / 10 ** CFG.decimals).toLocaleString(undefined, { maximumFractionDigits: CFG.decimals });
const credits = (raw) => fmt(raw) + " NSC";
// Evidence kinds. "attested" = a verified evidence bundle (sha256:<hash> for jobs, a 64-hex attestation hash for rounds).
const HEX64 = /^[0-9a-f]{64}$/;
const evKind = (ref) => (!ref ? "none" : /^sha256:[0-9a-f]{64}$/.test(ref) ? "attested" : "unverified");
const roundKind = (ev) => (!ev ? "none" : ev.ok !== false && HEX64.test(String(ev.attestation_hash || "")) && ev.model_id ? "attested" : "unverified");
const evTag = (kind) => kind === "attested" ? el("span", { class: "tag ok" }, "Attested")
  : kind === "unverified" ? el("span", { class: "tag warn" }, "Unverified") : el("span", { class: "tag idle" }, "No evidence");
const evLink = (j) => el("a", { href: CFG.evidenceBase + "job-" + j.id + ".json", target: "_blank", rel: "noopener" }, "evidence file");

// ---------- hero: receipt and rail ----------
const currentJob = () => jobs.find((x) => x.id === pickedJob) || jobs[jobs.length - 1];
function payoutOf(j) { const a = BigInt(j.amount); const fee = (a * CFG.feeBps) / 10000n; return { fee, payout: a - fee }; }
const jobTag = { Open: ["idle", "Open"], Funded: ["wait", "Funded"], Submitted: ["wait", "Submitted"], Settled: ["ok", "Settled"], Refunded: ["bad", "Refunded"] };

function renderSlip() {
  const box = $("slip"); if (!box) return;
  const j = currentJob();
  const art = el("div", { class: "slipart" });
  art.append(svgFrom(waveBand(460, 74, "#0a6b52")));
  art.append(el("div", { class: "title" }, el("h2", {}, "Settlement receipt"), el("span", { class: "serial" }, j ? "No. " + String(j.id).padStart(6, "0") : "No. 000000")));
  box.classList.toggle("paid", !!j && j.status === "Settled");
  if (!j) return put("slip", art, el("div", { class: "slipbody" }, el("p", { class: "empty" }, "No jobs yet. The first escrow will appear here.")));
  const { fee, payout } = payoutOf(j);
  const [kind, label] = jobTag[j.status] || ["idle", j.status];
  const k = evKind(j.evidence_ref);
  const settled = j.status === "Settled";
  const kids = [art,
    el("div", { class: "slipbody" },
      el("p", { class: "meta" }, "Job #" + j.id + " on NEAR testnet ", el("span", { class: "tag " + kind }, label)),
      el("dl", {},
        el("div", { class: "line" }, el("dt", {}, "Buyer"), el("dd", {}, link(j.buyer))),
        el("div", { class: "line" }, el("dt", {}, "Seller"), el("dd", {}, link(j.seller))),
        el("div", { class: "line" }, el("dt", {}, "Held in escrow"), el("dd", {}, credits(j.amount))),
        el("div", { class: "line" }, el("dt", {}, "Fee (1%)"), el("dd", {}, settled ? credits(String(fee)) : "on settlement")),
        el("div", { class: "line" }, el("dt", {}, "Evidence"), el("dd", {}, k === "none" ? "waiting" : evTag(k), k === "attested" ? [" ", evLink(j)] : "")),
        el("div", { class: "line total" }, el("dt", {}, settled ? "Seller received" : "Seller receives"), el("dd", {}, credits(String(payout - (j.splits || []).reduce((a, x) => a + shareOf(j, x), 0n)))))),
      ...(j.spec_text ? [el("p", { class: "task" }, el("span", { class: "sub" }, "Task: "), taskOnly(j.spec_text))] : []),
      ...((j.splits || []).length ? [el("dl", { class: "splitlines" }, ...j.splits.map((s) => el("div", { class: "line" }, el("dt", {}, "Also paid: " + short(s.account, 12)), el("dd", {}, credits(String(shareOf(j, s)))))))] : []),
      el("p", { class: "foot" }, j.result_hash ? ["Result hash ", el("span", { class: "hash" }, short(j.result_hash, 10))] : "No result submitted yet"))];
  if (settled && k === "attested") { const seal = el("div", { class: "seal" }); seal.append(svgFrom(sealSVG("VERIFIED", "\u2713", "ATTESTED", "#0a6b52"))); kids.push(seal); }
  put("slip", ...kids);
}
const taskOnly = (t) => { const i = t.indexOf("Task: ") >= 0 ? t.indexOf("Task: ") + 6 : t.indexOf("Brief: ") >= 0 ? t.indexOf("Brief: ") + 7 : 0; return t.slice(i); };
const shareOf = (j, s) => (payoutOf(j).payout * BigInt(s.bps)) / 10000n;
function railStations(j) {
  const { payout } = payoutOf(j);
  const funded = j.status !== "Open", submitted = !!j.result_hash, s = j.status, k = evKind(j.evidence_ref);
  const st = [];
  st.push({ state: funded ? "done" : "", title: funded ? "Escrow funded" : "Waiting for funds", detail: funded ? credits(j.amount) + " held for " + nameOf(j.seller) : "Buyer has not funded this job" });
  st.push({ state: submitted ? "done" : "", title: submitted ? "Result submitted" : "No result yet", detail: submitted ? ["Result hash ", el("span", { class: "hash" }, short(j.result_hash))] : "Seller has not submitted" });
  if (s === "Settled") st.push(k === "attested" ? { state: "done", title: "Hardware proof verified", detail: ["Bundle ", el("span", { class: "hash" }, short(j.evidence_ref.replace("sha256:", ""), 8))] } : { state: "warn", title: "Settled without a checkable bundle", detail: "The evidence reference is not a bundle hash." });
  else if (s === "Refunded" && submitted) st.push({ state: "bad", title: "Not accepted", detail: "Verifier did not approve the result" });
  else if (s === "Submitted") st.push({ state: "", title: "Waiting for the verifier", detail: "Result is submitted and unchecked" });
  else st.push({ state: "", title: "Evidence not checked", detail: "Comes after a result is submitted" });
  if (s === "Settled") st.push({ state: k === "attested" ? "done" : "warn", title: "Seller paid", detail: credits(String(payout)) + " after the 1% fee" });
  else if (s === "Refunded") st.push({ state: "bad", title: "Buyer refunded", detail: credits(j.amount) + " returned" });
  else st.push({ state: "", title: "Not paid yet", detail: "Pays only after the evidence is accepted" });
  return st;
}
function renderRail() {
  const j = currentJob();
  if (!j) { put("railhead"); put("rail"); return; }
  if ($("rail")) $("rail").classList.toggle("static", j.id === shownJob);
  shownJob = j.id;
  put("railhead", el("b", {}, "Job #" + j.id), el("span", {}, nameOf(j.buyer) + " hires " + nameOf(j.seller) + " for " + credits(j.amount)));
  put("rail", ...railStations(j).map((s, i) => el("li", { class: "station " + s.state, style: "--i:" + i },
    el("span", { class: "dot", "aria-hidden": "true" }), el("div", { class: "st-title" }, s.title), el("div", { class: "st-detail" }, s.detail))));
}

// ---------- honesty strip and stats ----------
function renderStats() {
  const settled = jobs.filter((j) => j.status === "Settled");
  const paid = settled.reduce((s, j) => s + payoutOf(j).payout, 0n);
  const att = settled.filter((j) => evKind(j.evidence_ref) === "attested").length + rounds.filter((r) => roundKind(r.evidence) === "attested").length;
  const cells = PAGE === "arena" ? [
    [String(rounds.filter(openNow).length), "rounds open now", false],
    [String(rounds.length), rounds.length === 1 ? "round played" : "rounds played", false],
    [String(buildBoard(false).length), "players ranked", false],
    [String(rounds.filter((r) => roundKind(r.evidence) === "attested").length), "attested rounds", att > 0],
  ] : [
    [String(settled.length), "jobs settled by escrow", false],
    [fmt(String(paid)) + " NSC", "paid to sellers", false],
    [String(rounds.length), rounds.length === 1 ? "Arena round played" : "Arena rounds played", false],
    [String(att), "attested settlements", att > 0],
  ];
  put("stats", ...cells.map(([v, l, good]) => el("div", { class: "stat" + (good ? " good" : "") }, el("b", {}, v), el("span", {}, l))));
}

// ---------- ledger, reputation, balances ----------
function renderJobs() {
  if (!$("jobtable")) return;
  wireSearch("jobsearch", "jobs");
  if (!jobs.length) return put("jobtable", el("p", { class: "empty" }, "No jobs yet. A buyer funds the first escrow with node services/buyer.mjs, and it appears here within seconds."));
  const list = jobs.slice().reverse().filter((j) => matches("jobs", "#" + j.id, j.buyer, j.seller, j.status));
  const pg = pageOf("jobs", list, 10);
  const rows = pg.slice.map((j) => {
    const [kind, label] = jobTag[j.status] || ["idle", j.status];
    return el("tr", { class: j.id === currentJob().id ? "sel" : "" },
      el("td", { class: "jobno" }, el("button", { type: "button", "aria-label": "Show job " + j.id,
        onclick: () => { pickedJob = j.id; renderAll(); window.scrollTo({ top: 0, behavior: "smooth" }); } }, "#" + j.id)),
      el("td", {}, link(j.buyer), " pays ", link(j.seller)),
      el("td", {}, credits(j.amount)),
      el("td", {}, el("span", { class: "tag " + kind }, label)),
      el("td", {}, evKind(j.evidence_ref) === "none" ? el("span", { class: "sub" }, "none") : evTag(evKind(j.evidence_ref))));
  });
  put("jobtable", el("table", {}, el("thead", {}, el("tr", {}, ["Job", "Parties", "Amount", "Status", "Evidence"].map((h) => el("th", {}, h)))), el("tbody", {}, rows)), pg.pager);
}
function renderRep() {
  const rows = reps.filter((r) => r.rep.settled_jobs > 0);
  if (!rows.length) return put("rep", el("p", { class: "empty" }, "Nobody has a record yet. The first settled job creates one."));
  const max = Math.max(...rows.map((r) => Number(BigInt(r.rep.score))));
  put("rep", el("ul", { class: "rows" }, rows.map((r) =>
    el("li", {}, el("span", {}, link(r.account), " ", el("span", { class: "sub" }, r.rep.settled_jobs + (r.rep.settled_jobs === 1 ? " settled job" : " settled jobs"))),
      el("b", {}, credits(r.rep.score)),
      el("span", { class: "meter" }, el("i", { style: "width:" + Math.max(4, (Number(BigInt(r.rep.score)) / max) * 100) + "%" }))))));
}
function renderBal() {
  put("bal", el("ul", { class: "rows" }, bals.map((b) => el("li", {}, link(b.account), el("b", {}, credits(b.balance))))));
}

// ---------- arena: how to play, rules, leaderboard ----------
function renderHowto() {
  put("howto",
    el("div", { class: "howto" },
      el("div", { class: "hcard" }, el("h3", {}, "How a round works"),
        el("ol", {},
          el("li", {}, "The dealer asks a question. One answer was really written by an attested model on NEAR AI Cloud. The others are decoys, written by liar agents or by other players."),
          el("li", {}, "The dealer seals the real position with a hash before anyone guesses, so it cannot be changed later."),
          el("li", {}, "You stake test credits on the answer you think is real."),
          el("li", {}, "After the deadline the dealer reveals the position and the hardware proof for the real answer. The contract checks both before paying anyone."))),
      el("div", { class: "hcard" }, el("h3", {}, "What you can win"),
        el("ul", {},
          el("li", {}, "Right guess: you split the pot with the other right guessers. The pot is every stake minus a 1% fee. If liars fooled anyone, liars take 20% of it first."),
          el("li", {}, "A round where nobody is right and nobody is fooled refunds everyone."),
          el("li", {}, "Sponsored rounds carry a prize on top, split among right guessers."),
          el("li", {}, "Wrong guess: you lose that round's stake."),
          el("li", {}, "Dealer never reveals or proof fails: the round is voided and every stake is refundable."),
          el("li", {}, "Every settled round earns points. Points raise your rank (Rookie, Detective, Verifier, Elite, Legend) and unlock harder tiers. The Daily Boss needs a season pass."),
          el("li", {}, "Test credits (NSC) have no cash value. This is a game on testnet.")))),
    el("details", { class: "help" }, el("summary", {}, "Why does my wallet ask for about 0.25 NEAR?"),
      el("p", {}, "When you connect, wallets usually ask you to approve a limited access key for the Arena contract with a fee allowance of around 0.25 NEAR. It is a spending cap for contract calls, not a payment, and on testnet it is test NEAR with no value. Staking itself costs only test credits (NSC)."),
      el("p", {}, "If your testnet account has no NEAR at all, the wallet cannot sign. Use step 2 of Join the Arena: check your balance, request free testnet NEAR from the faucet, then try again.")));
}
const RANKS = [["Rookie", 0], ["Detective", 25], ["Verifier", 80], ["Elite", 180], ["Legend", 400]];
const TIER = { 1: { name: "Easy", need: 0 }, 2: { name: "Medium", need: 25 }, 3: { name: "Hard", need: 80 }, 4: { name: "Daily Boss", need: 0, pass: true } };
const tierOf = (r) => Math.min(Math.max(r.answers.length - 1, 1), 4);
const rankOf = (pts) => { let i = 0; RANKS.forEach(([, n], k) => { if (pts >= n) i = k; }); return { i, name: RANKS[i][0], next: RANKS[i + 1] || null, floor: RANKS[i][1] }; };
let calls = [], drafts = {};
let pass = { price: null, pool: null, sold: null, mine: false }, selTier = null;
const myPts = () => { const e = me ? buildBoard(true).find((x) => x.player === me) : null; return e ? e.points : 0; };
const tierOpen = (t) => { const T = TIER[t]; if (!me) return true; return T.pass ? pass.mine : myPts() >= T.need; };
const lockNote = (t) => { const T = TIER[t]; return T.pass ? "Needs a season pass" : "Reach " + RANKS.find(([, n]) => n >= T.need)[0] + " (" + T.need + " points)"; };
const showQ = (q) => String(q).replace(/ Reply with only the text, at most two sentences\.$/, "");
const POINTS = { played: 1, correct: 10, streakStep: 2, streakCap: 10 };
const playerOf = (g) => { for (const v of Object.values(g)) if (typeof v === "string" && /\.(testnet|near)$/.test(v)) return v; return null; };
function buildBoard(includeOurs = false) {
  const ours = includeOurs ? new Set() : new Set(Object.values(CFG.accounts).concat([CFG.escrow, CFG.arena, CFG.token, CFG.pass]));
  const by = new Map();
  for (const r of rounds.filter((x) => x.status === "Settled").sort((a, b) => a.id - b.id)) {
    for (const g of r.guesses) {
      const p = playerOf(g);
      if (!p || ours.has(p)) continue;
      const e = by.get(p) || { player: p, played: 0, correct: 0, streak: 0, best: 0, points: 0 };
      e.played++; e.points += POINTS.played;
      if (g.choice === r.real_index) {
        e.correct++; e.streak++; e.best = Math.max(e.best, e.streak);
        e.points += POINTS.correct + Math.min((e.streak - 1) * POINTS.streakStep, POINTS.streakCap);
      } else e.streak = 0;
      by.set(p, e);
    }
  }
  return [...by.values()].sort((a, b) => b.points - a.points || b.correct / b.played - a.correct / a.played || a.player.localeCompare(b.player));
}
function renderBoard() {
  if (!$("boardtable")) return;
  wireSearch("boardsearch", "board");
  const all = buildBoard();
  if ($("boardnote")) $("boardnote").textContent = "Points: " + POINTS.played + " for playing a settled round, " + POINTS.correct + " for a correct guess, and +" + POINTS.streakStep + " for each extra correct guess in a row (up to +" + POINTS.streakCap + ").";
  if (!all.length) return put("boardtable", el("p", { class: "empty" }, "No settled rounds with players yet. Play a round and your name goes here."));
  const ranked = all.map((e, i) => Object.assign({ rank: i + 1 }, e)).filter((e) => matches("board", e.player));
  const pg = pageOf("board", ranked, 15);
  put("boardtable", el("table", {},
    el("thead", {}, el("tr", {}, [["#", "n"], ["Player", ""], ["Rank", ""], ["Rounds", "n"], ["Correct", "n"], ["Accuracy", "n"], ["Streak", "n"], ["Points", "n"]].map(([h, c]) => el("th", { class: c }, h)))),
    el("tbody", {}, pg.slice.map((e) => el("tr", { class: e.player === me ? "me" : "" },
      el("td", { class: "n" }, String(e.rank)), el("td", {}, link(e.player, e.player), e.player === me ? " (you)" : ""), el("td", {}, el("span", { class: "tag idle" }, rankOf(e.points).name)),
      el("td", { class: "n" }, String(e.played)), el("td", { class: "n" }, String(e.correct)),
      el("td", { class: "n" }, Math.round((e.correct / e.played) * 100) + "%"), el("td", { class: "n" }, String(e.streak)),
      el("td", { class: "n" }, String(e.points)))))), pg.pager);
}

function renderLiars() {
  if (!$("liartable")) return;
  const by = new Map();
  for (const r of rounds.filter((x) => x.status === "Settled" && Array.isArray(x.authors) && x.authors.length)) {
    const seen = new Set();
    r.authors.forEach((a) => { if (a) seen.add(a); });
    seen.forEach((a) => { const e = by.get(a) || { who: a, rounds: 0, fooled: 0 }; e.rounds++; by.set(a, e); });
    for (const g of r.guesses) {
      const a = r.authors[g.choice];
      if (a && g.choice !== r.real_index) by.get(a).fooled++;
    }
  }
  const rows = [...by.values()].sort((a, b) => b.fooled - a.fooled);
  if (!rows.length) return put("liartable", el("p", { class: "empty" }, "No liar has fooled anyone yet."));
  const pg = pageOf("liars", rows, 15);
  put("liartable", el("table", {},
    el("thead", {}, el("tr", {}, [["#", "n"], ["Liar agent", ""], ["Rounds", "n"], ["Fooled", "n"]].map(([h, c]) => el("th", { class: c }, h)))),
    el("tbody", {}, pg.slice.map((e, i) => el("tr", {}, el("td", { class: "n" }, String(pg.start + i + 1)), el("td", {}, link(e.who, e.who)), el("td", { class: "n" }, String(e.rounds)), el("td", { class: "n" }, String(e.fooled)))))), pg.pager);
}
function renderHud() {
  const box = $("hud"); if (!box) return;
  if (!me) return box.replaceChildren();
  const all = buildBoard(true), mine = all.find((x) => x.player === me);
  const pts = mine ? mine.points : 0, rk = rankOf(pts);
  const span = rk.next ? rk.next[1] - rk.floor : 1;
  box.replaceChildren(el("div", { class: "hud" },
    el("div", {}, el("div", { class: "rank" }, rk.name), el("div", { class: "stat2" }, pts + " points")),
    el("div", { class: "prog" }, el("small", {}, rk.next ? (rk.next[1] - pts) + " points to " + rk.next[0] : "Top rank reached"), el("div", { class: "bar2" }, el("i", { style: "width:" + (rk.next ? Math.min(100, ((pts - rk.floor) / span) * 100) : 100) + "%" }))),
    el("div", { class: "stat2" }, el("b", {}, String(mine ? mine.streak : 0)), "streak"),
    el("div", { class: "stat2" }, el("b", {}, mine ? Math.round((mine.correct / mine.played) * 100) + "%" : "none yet"), "accuracy"),
    el("div", { class: "stat2" }, el("b", {}, pass.mine ? "Active" : "None"), "season pass")));
}
function renderTiers() {
  const box = $("tiers"); if (!box) return;
  const count = (t) => rounds.filter((r) => openNow(r) && tierOf(r) === t).length;
  const cards = [el("button", { type: "button", class: "tier" + (selTier === null ? " on" : ""), onclick: () => { selTier = null; renderTiers(); renderRounds(); } }, el("b", {}, "All rounds"), el("span", {}, rounds.filter(openNow).length + " open"))];
  for (const t of [1, 2, 3, 4]) {
    const open = tierOpen(t);
    cards.push(el("button", { type: "button", class: "tier" + (selTier === t ? " on" : "") + (open ? "" : " locked"), onclick: () => { selTier = t; renderTiers(); renderRounds(); } },
      open ? "" : icon("lock"), el("b", {}, TIER[t].name), el("span", {}, (t + 1) + " answers" + (open ? "" : ", locked") + ", " + count(t) + " open")));
  }
  box.replaceChildren(...cards);
}
const nearOf = (y) => (Number(BigInt(y) / 10n ** 20n) / 10000).toLocaleString(undefined, { maximumFractionDigits: 4 });
function renderPass() {
  const box = $("passbox"); if (!box) return;
  if (!CFG.pass || pass.price === null) return box.replaceChildren();
  const buy = me ? el("button", { class: "pbtn go", type: "button", disabled: busy ? "" : null, onclick: buyPass }, pass.mine ? "Extend pass" : "Buy season pass, " + nearOf(pass.price) + " NEAR") : el("button", { class: "pbtn", type: "button", onclick: connect }, "Sign in to buy");
  box.replaceChildren(el("div", { class: "passbox" },
    el("span", { class: "grow" }, el("b", {}, "Season pass. "), "Paid in testnet NEAR. Unlocks the Daily Boss and fills the prize pool, now ", el("b", {}, nearOf(pass.pool) + " NEAR"), " from ", String(pass.sold), pass.sold === 1 ? " pass." : " passes."),
    buy));
}
const buyPass = () => send(CFG.pass, [["buy_pass", {}, STAKE_GAS, pass.price]]);
async function refreshPass() {
  if (!CFG.pass) return;
  try {
    const [price, pool, sold] = await Promise.all([rpcView(CFG.pass, "get_price"), rpcView(CFG.pass, "get_pool"), rpcView(CFG.pass, "passes_sold")]);
    pass.price = price; pass.pool = pool; pass.sold = sold;
  } catch (e) { /* the pass contract is optional */ }
  try { pass.mine = me ? await rpcView(CFG.pass, "has_pass", { account_id: me }) : false; } catch (e) { pass.mine = false; }
  renderPass(); renderHud(); renderTiers();
}

async function readCalls() {
  const out = [];
  for (let i = 1; i < 100; i++) { const c = await rpcView(CFG.arena, "get_call", { call_id: i }); if (!c) break; out.push(c); }
  return out;
}
function renderCalls() {
  const box = $("liarcall"); if (!box) return;
  const open = calls.filter((c) => Date.now() < Number(c.closes_ms));
  if (!open.length) return box.replaceChildren();
  if (box.contains(document.activeElement) && document.activeElement.tagName === "TEXTAREA") return; // do not wipe what someone is typing
  box.replaceChildren(...open.map((c) => {
    const mine = me && c.decoys.some((d) => d.author === me);
    const ta = el("textarea", { maxlength: "280", placeholder: "Type a convincing answer to the question above", "aria-label": "Your decoy" });
    ta.value = drafts[c.id] || "";
    ta.addEventListener("input", () => { drafts[c.id] = ta.value; });
    return el("div", { class: "callbox" },
      el("h3", {}, "Be the Liar"),
      el("p", {}, el("b", {}, "Today's question: "), showQ(c.prompt)),
      el("p", {}, "Type your own answer to it, written so it could pass for the AI's. Up to 280 characters. The best fakes go into the next round beside the machine's real answer, and when a player picks yours, you earn a share of that round's pot. " + c.decoys.length + (c.decoys.length === 1 ? " fake" : " fakes") + " submitted so far."),
      mine ? el("span", { class: "tag ok" }, "Your decoy is in") : [ta,
        el("div", { class: "row" },
          me ? el("button", { class: "pbtn go", type: "button", disabled: busy ? "" : null, onclick: () => { const t = (drafts[c.id] || "").trim(); if (!t) { flashMsg = { kind: "err", text: "Write something first." }; return renderWallet(); } send(CFG.arena, [["submit_decoy", { call_id: c.id, text: t }, STAKE_GAS]]); } }, "Submit my decoy")
             : el("button", { class: "pbtn", type: "button", onclick: connect }, "Sign in to submit"),
          el("span", { class: "count", "data-closes": String(Number(c.closes_ms)) }, ""))]);
  }));
}

// ---------- practice: replay a past round, no wallet and nothing at stake ----------
let practice = { id: null, pick: null };
function renderPractice() {
  const box = $("practice"); if (!box) return;
  const pool = rounds.filter((r) => r.status === "Settled" && r.real_index !== null && r.real_index !== undefined);
  if (!pool.length) return box.replaceChildren(el("p", { class: "empty" }, "Past rounds appear here after the first round has been revealed. Check back soon."));
  let r = pool.find((x) => x.id === practice.id);
  if (!r) { r = pool[Math.floor(Math.random() * pool.length)]; practice = { id: r.id, pick: null }; }
  const done = practice.pick !== null, right = done && practice.pick === r.real_index;
  const next = () => { const others = pool.filter((x) => x.id !== r.id); const n = (others.length ? others : pool)[Math.floor(Math.random() * (others.length || pool.length))]; practice = { id: n.id, pick: null }; renderPractice(); };
  box.replaceChildren(el("div", { class: "round" },
    el("div", {}, el("span", { class: "tag idle" }, "Practice"), " ", el("span", { class: "tag idle" }, TIER[tierOf(r)].name), " ", el("span", { class: "sub" }, "From round " + r.id),
      el("p", { class: "q" }, showQ(r.question)),
      done ? el("p", { class: "playnote" }, el("span", { class: right ? "tag ok" : "tag bad" }, right ? "Spotted" : "Fooled"), " ", right ? "That one was written by the attested model." : "The real answer was " + String.fromCharCode(65 + r.real_index) + ".", " ",
        el("a", { href: CFG.evidenceBase + "round-" + r.id + ".json", target: "_blank", rel: "noopener" }, "See the proof")) : el("p", { class: "playnote" }, "Pick the answer you think the machine wrote. Nothing is staked here."),
      done ? el("button", { class: "pbtn go", type: "button", onclick: next }, "Try another round") : ""),
    el("ul", { class: "answers" }, r.answers.map((a, i) => {
      const real = done && r.real_index === i, picks = r.guesses.filter((g) => g.choice === i).length;
      return el("li", { class: real ? "real" : "" }, el("span", { class: "letter" }, String.fromCharCode(65 + i)), el("span", {}, a),
        real ? el("span", { class: "tag ok" }, "Real") : "", done && practice.pick === i ? el("span", { class: "tag idle" }, "Your pick") : "",
        done && picks ? el("span", { class: "picks" }, picks + (picks === 1 ? " player" : " players")) : "",
        done ? "" : el("button", { class: "pbtn", type: "button", onclick: () => { practice.pick = i; renderPractice(); } }, "Pick"));
    }))));
}

// ---------- arena ----------
const roundTag = { Open: ["wait", "Open"], Settled: ["ok", "Settled"], Voided: ["bad", "Voided and refunded"] };
function renderRounds() {
  if (!rounds.length) return put("rounds", el("p", { class: "empty" }, "No rounds open right now. The autopilot opens fresh rounds every few hours. Check back soon, or open the leaderboard while you wait."));
  const shown = rounds.filter((r) => selTier === null || tierOf(r) === selTier);
  if (!shown.length) return put("rounds", el("p", { class: "empty" }, "No rounds in this tier right now. Check another tier or come back soon."));
  put("rounds", ...shown.slice().reverse().map((r) => {
    const ev = r.evidence, k = roundKind(ev);
    const [kind, label] = roundTag[r.status] || ["idle", r.status];
    const evLine = ev
      ? el("p", { class: "ev" }, evTag(k), el("span", {}, "Model " + ev.model_id), el("span", {}, "Signature " + ev.signature_kind), el("span", {}, "Evidence ", k === "attested" ? el("a", { href: CFG.evidenceBase + "round-" + r.id + ".json", target: "_blank", rel: "noopener" }, short(ev.attestation_hash)) : el("span", { class: "hash" }, short(ev.attestation_hash))))
      : el("p", { class: "ev" }, el("span", { class: "tag idle" }, "Sealed"), el("span", {}, "Real answer committed: ", el("span", { class: "hash" }, short(r.commit))));
    return el("div", { class: "round" },
      el("div", {}, el("span", { class: "tag " + kind }, label), " ", el("span", { class: "tag idle" }, TIER[tierOf(r)].name), " ", (r.bonus && BigInt(r.bonus) > 0n) ? el("span", { class: "tag ok" }, "Prize +" + credits(r.bonus)) : "", " ", (r.call_id !== null && r.call_id !== undefined) ? el("span", { class: "tag idle" }, "Player decoys") : "", " ",
        el("span", { class: "sub" }, "Round " + r.id + ", " + r.guesses.length + (r.guesses.length === 1 ? " guess" : " guesses") + ", stake " + credits(r.stake)),
        el("p", { class: "q" }, showQ(r.question)), evLine, playNote(r)),
      el("ul", { class: "answers" }, r.answers.map((a, i) => {
        const real = r.real_index === i, picks = r.guesses.filter((g) => g.choice === i).length;
        return el("li", { class: real ? "real" : "" }, el("span", { class: "letter" }, String.fromCharCode(65 + i)), el("span", {}, a),
          real ? el("span", { class: "tag ok" }, "Real") : "", picks ? el("span", { class: "picks" }, picks + (picks === 1 ? " pick" : " picks")) : "", playBtn(r, i));
      })));
  }));
}

function renderAll() { renderPractice(); renderWallet(); if (typeof renderHire === "function") renderHire(); tickCountdowns(); renderSlip(); renderRail(); renderStats(); renderJobs(); renderRep(); renderBal(); renderRounds(); renderBoard(); renderLiars(); renderHud(); renderTiers(); renderPass(); renderCalls(); renderDoors(); renderPassport(); renderTicker(); }


// ---------- join: get an account, get test NEAR, sign in ----------
const joinUI = {};
const NEAR_MIN = 5n * 10n ** 22n; // 0.05 NEAR is plenty for the access key and a few calls
const nearText = (y) => (Number(BigInt(y) / 10n ** 21n) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
async function rpcAccountBalance(name) {
  let last;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: name } }) });
      const j = await res.json();
      if (j.error) { const m = JSON.stringify(j.error); if (/does not exist|UnknownAccount/i.test(m)) return null; throw new Error(j.error.data || j.error.message); }
      return BigInt(j.result.amount);
    } catch (e) { last = e; }
  }
  throw last;
}
async function checkBalance() {
  const name = joinUI.input.value.trim().toLowerCase().replace(/\s+/g, "");
  if (!/^[a-z0-9._-]{2,64}\.testnet$/.test(name)) { joinUI.result.className = "flash err"; joinUI.result.textContent = "Type your full account name, for example yourname.testnet."; return; }
  joinUI.result.className = "flash"; joinUI.result.textContent = "Checking…";
  try {
    const bal = await rpcAccountBalance(name);
    if (bal === null) { joinUI.result.className = "flash err"; joinUI.result.textContent = "That account does not exist on testnet yet. Create it in step 1 first."; joinUI.faucet.hidden = true; }
    else if (bal < NEAR_MIN) { joinUI.result.className = "flash err"; joinUI.result.textContent = "It has " + nearText(bal) + " NEAR. Add some from a faucet below, then check again."; joinUI.faucet.hidden = false; }
    else { joinUI.result.className = "flash ok"; joinUI.result.textContent = "Ready: " + nearText(bal) + " NEAR. Go to step 3."; joinUI.faucet.hidden = true; }
  } catch (e) { joinUI.result.className = "flash err"; joinUI.result.textContent = "Could not check right now (" + e.message + "). Try again in a moment."; }
}
function renderJoin() {
  const box = $("join");
  if (!box) return;
  if (!joinUI.root) {
    joinUI.input = el("input", { type: "text", id: "joinname", placeholder: "yourname.testnet", autocomplete: "off", spellcheck: "false" });
    joinUI.input.addEventListener("keydown", (e) => { if (e.key === "Enter") checkBalance(); });
    joinUI.result = el("span", { class: "flash", role: "status" });
    joinUI.faucet = el("div", { class: "faucetrow", hidden: "" },
      el("a", { class: "pbtn go", href: "https://docs.near.org/getting-started/faucet", target: "_blank", rel: "noopener" }, "Open the NEAR faucet"),
      el("a", { class: "pbtn", href: "https://near-faucet.io", target: "_blank", rel: "noopener" }, "Backup faucet"));
    joinUI.root = el("div", { class: "join" },
      el("h2", { class: "sec" }, "Join the Arena"),
      el("p", { class: "intro" }, "You do this once, in about two minutes. Everything here is testnet, so nothing costs real money."),
      el("div", { class: "steps3" },
        el("div", { class: "step3" }, el("h3", {}, "1. Get a testnet account"),
          el("p", {}, "Make a free account in any NEAR wallet. Choose a name that ends in .testnet."),
          el("div", { class: "faucetrow" },
            el("a", { class: "pbtn go", href: "https://wallet.meteorwallet.app", target: "_blank", rel: "noopener" }, "Meteor Wallet"),
            el("a", { class: "pbtn", href: "https://testnet.mynearwallet.com", target: "_blank", rel: "noopener" }, "MyNearWallet"))),
        el("div", { class: "step3" }, el("h3", {}, "2. Add free test NEAR"),
          el("p", {}, "A new account can start empty, and an empty account cannot sign in. Check yours, and top it up if needed."),
          el("div", { class: "faucetrow" }, joinUI.input, el("button", { class: "pbtn", type: "button", onclick: checkBalance }, "Check balance")),
          el("div", {}, joinUI.result), joinUI.faucet),
        el("div", { class: "step3" }, el("h3", {}, "3. Sign in and play"),
          el("p", {}, "Choose your wallet. It asks for a small spending cap for contract calls, which is test NEAR."),
          el("div", { class: "faucetrow" }, el("button", { class: "pbtn go", type: "button", onclick: connect }, "Sign in with my wallet")))));
    box.append(joinUI.root);
  }
  joinUI.root.hidden = !!me;
}

// ---------- play: connect a wallet, stake on an answer, claim ----------
const WALLET_VERSIONS = ["8.10.2", "8.9.15", "8.9.13", "8.9.5"];
const STAKE_GAS = 100n * 10n ** 12n;
let selector = null, modal = null, me = null, myBalance = null, myClaim = {}, walletState = "idle", flashMsg = null, busy = false;
const num = (x) => Number(x);
const openNow = (r) => r.status === "Open" && Date.now() < num(r.closes_ms);
const myGuess = (r) => (me ? r.guesses.find((g) => Object.values(g).includes(me)) : null);

async function loadWallet() {
  if (selector || walletState === "loading") return;
  walletState = "loading"; renderWallet();
  for (const v of WALLET_VERSIONS) {
    try {
      const base = "https://esm.sh/@near-wallet-selector/";
      const [core, ui] = await Promise.all([import(base + "core@" + v), import(base + "modal-ui@" + v)]);
      const mods = [];
      for (const [pkg, fn] of [["my-near-wallet", "setupMyNearWallet"], ["meteor-wallet", "setupMeteorWallet"]]) {
        try { const m = await import(base + pkg + "@" + v); mods.push(m[fn]()); } catch (e) { console.warn("wallet module skipped", pkg, e); }
      }
      if (!mods.length) throw new Error("no wallet modules loaded");
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = "https://cdn.jsdelivr.net/npm/@near-wallet-selector/modal-ui@" + v + "/styles.css";
      document.head.append(css);
      selector = await core.setupWalletSelector({ network: { networkId: "testnet", nodeUrl: "https://test.rpc.fastnear.com", helperUrl: "https://helper.testnet.near.org", explorerUrl: "https://testnet.nearblocks.io", indexerUrl: "https://testnet-api.kitwallet.app" }, modules: mods });
      modal = ui.setupModal(selector, { contractId: CFG.arena });
      const sync = (state) => { const a = (state.accounts || []).find((x) => x.active) || (state.accounts || [])[0]; me = a ? a.accountId : null; refreshMine(); };
      sync(selector.store.getState());
      selector.store.observable.subscribe(sync);
      walletState = "ready"; renderWallet();
      return;
    } catch (e) { console.warn("wallet library " + v + " failed", e); }
  }
  walletState = "unavailable"; renderWallet();
}
async function connect() { await loadWallet(); if (modal) modal.show(); }
async function signOut() { try { const w = await selector.wallet(); await w.signOut(); } catch (e) { console.warn(e); } me = null; myBalance = null; renderAll(); }
const friendly = (e) => {
  const m = String(e && e.message ? e.message : e);
  if (/Exceeded \d+ attempts|fetch|network|timeout|timed out/i.test(m)) return "The NEAR network was slow to answer, so nothing was sent. Try again in a moment.";
  if (/clos|cancel|reject|denied|declin|abort/i.test(m)) return "The wallet window was closed before you approved, so nothing was sent.";
  return "The wallet did not send it: " + m;
};
async function send(receiver, actions, okText) {
  if (busy) return;
  busy = true; flashMsg = { kind: "ok", text: "Opening your wallet. Approve the transaction in the pop-up window." }; renderWallet(); renderRounds();
  try {
    const w = await selector.wallet();
    await w.signAndSendTransaction({ receiverId: receiver, actions: actions.map(([methodName, args, gas, deposit]) => ({ type: "FunctionCall", params: { methodName, args, gas: String(gas), deposit: deposit || "0" } })) });
    flashMsg = { kind: "ok", text: okText || "Sent. Your balance and the rounds update in a few seconds." };
    setTimeout(refresh, 3500); setTimeout(refresh, 9000);
  } catch (e) { flashMsg = { kind: "err", text: friendly(e) }; }
  busy = false; renderWallet(); renderRounds();
}
const getCredits = () => send(CFG.token, [["register", { account_id: me }, 30n * 10n ** 12n], ["faucet", { amount: "20000000" }, 30n * 10n ** 12n]], "You now have 20 free test credits (NSC).");
const stakeOn = (r, i) => {
  if (!tierOpen(tierOf(r))) { flashMsg = { kind: "err", text: "This tier is locked. " + lockNote(tierOf(r)) + "." }; return renderWallet(); }
  if (BigInt(myBalance ?? "0") < BigInt(r.stake)) { flashMsg = { kind: "err", text: "Not enough test credits. Use Get test credits first." }; return renderWallet(); }
  return send(CFG.token, [["ft_transfer_call", { receiver_id: CFG.arena, amount: String(r.stake), msg: r.id + ":" + i }, STAKE_GAS, "1"]], "Pick locked in: " + credits(r.stake) + " is staked on answer " + String.fromCharCode(65 + i) + ". The result appears here after the round closes.");
};
const claim = () => send(CFG.arena, [["claim", { token: CFG.token }, STAKE_GAS]], "Claimed. The winnings are in your balance.");

async function refreshMine() {
  if (!me) { myBalance = null; myClaim = {}; return renderWallet(); }
  refreshPass();
  try { myBalance = await rpcView(CFG.token, "ft_balance_of", { account_id: me }); } catch (e) { /* keep the last value */ }
  try { const c = await rpcView(CFG.arena, "get_claimable", { account_id: me, token: CFG.token }); myClaim = { amount: c }; } catch (e) { myClaim = {}; }
  renderWallet(); renderRounds();
}
const cliLine = (r, i) => "near contract call-function as-transaction " + CFG.token + " ft_transfer_call json-args '" +
  JSON.stringify({ receiver_id: CFG.arena, amount: String(r.stake), msg: r.id + ":" + i }) + "' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as YOUR_ACCOUNT.testnet network-config testnet sign-with-legacy-keychain send";

function renderWallet() {
  renderJoin();
  if (typeof renderHire === "function") renderHire();
  const bar = $("walletbar");
  if (!bar) return;
  const ns = $("navsign");
  if (ns) ns.textContent = me ? me : "Sign in"; if (ns) { ns.onclick = me ? signOut : (PAGE === "arena" || PAGE === "passport" || PAGE === "hire" ? connect : () => { location.href = "arena.html#join"; }); ns.title = me ? "Sign out" : "Sign in with your NEAR testnet account"; }
  const kids = [];
  const open = rounds.filter(openNow);
  if (walletState === "loading") kids.push(el("span", { class: "grow" }, "Loading wallet options…"));
  else if (me) {
    kids.push(el("span", { class: "who" }, "Playing as ", el("b", {}, me), myBalance !== null ? " · " + credits(myBalance) : ""));
    if (myBalance !== null && BigInt(myBalance) === 0n) kids.push(el("button", { class: "pbtn go", type: "button", disabled: busy ? "" : null, onclick: getCredits }, "Get test credits"));
    kids.push(el("button", { class: "pbtn", type: "button", onclick: signOut }, "Sign out"));
  } else {
    kids.push(el("button", { class: "pbtn go", type: "button", onclick: connect }, "Sign in to play"));
    kids.push(el("span", { class: "grow" }, "Any NEAR testnet account works. Test credits are free and have no cash value."));
  }
  if (walletState === "unavailable") kids.push(el("span", { class: "flash err" }, "The wallet library could not load in this browser. You can still play from a terminal, see below."));
  if (flashMsg) kids.push(el("span", { class: "flash " + flashMsg.kind, role: "status" }, flashMsg.text));
  if (open.length && (walletState === "unavailable" || !me)) {
    const r = open[open.length - 1];
    kids.push(el("details", {}, el("summary", {}, "Prefer a terminal? Stake on round " + r.id + " with the near CLI"),
      el("pre", {}, "# answer A is 0, B is 1, C is 2. Change the last digit of msg to pick.\n" + cliLine(r, 0))));
  }
  bar.replaceChildren(...kids);
}
function playBtn(r, i) {
  const mine = myGuess(r);
  if (mine && mine.choice === i) return el("span", { class: "tag ok" }, "Your pick");
  if (!openNow(r)) return "";
  if (!me) return el("button", { class: "pbtn", type: "button", onclick: connect }, "Play");
  if (mine) return "";
  if (!tierOpen(tierOf(r))) return el("span", { class: "tag idle", title: lockNote(tierOf(r)) }, "Locked");
  return el("button", { class: "pbtn go", type: "button", disabled: busy ? "" : null, onclick: () => stakeOn(r, i) }, "Pick this answer");
}
function playNote(r) {
  const mine = myGuess(r);
  if (openNow(r) && !tierOpen(tierOf(r))) return el("p", { class: "playnote" }, el("span", { class: "count", "data-closes": String(num(r.closes_ms)) }, ""), el("span", {}, "Locked. " + lockNote(tierOf(r)) + " to play this round."));
  if (openNow(r)) return el("p", { class: "playnote" }, el("span", { class: "count", "data-closes": String(num(r.closes_ms)) }, ""), mine ? el("span", {}, "You have guessed. Waiting for the reveal.") : el("span", {}, "Pick the answer you think the model really wrote. A pick costs " + credits(r.stake) + ", and winners split the pot."));
  if (r.status === "Open") return el("p", { class: "playnote" }, "Guessing is closed. Waiting for the dealer to reveal the real answer.");
  if (r.status === "Settled" || r.status === "Voided") {
    if (me && mine) {
      const got = myClaim.amount && BigInt(myClaim.amount) > 0n;
      const right = r.status === "Settled" && mine.choice === r.real_index;
      const msg = r.status === "Voided" ? "This round was voided and your stake is refundable."
        : right ? "You spotted the machine. Your share of the pot is waiting for you." + (got ? " You can claim " + credits(myClaim.amount) + "." : "")
        : "The machine fooled you. The real answer was " + String.fromCharCode(65 + r.real_index) + ".";
      return el("p", { class: "playnote" }, el("span", { class: right ? "tag ok" : "tag idle" }, right ? "Correct" : r.status === "Voided" ? "Voided" : "Missed"), " ", msg, " ",
        (right && got) || r.status === "Voided" ? el("button", { class: "pbtn go", type: "button", disabled: busy ? "" : null, onclick: claim }, "Claim") : "", r.status === "Settled" ? shareLink(r, mine) : "");
    }
    if (r.status === "Settled") return el("p", { class: "playnote" }, "Round over. The real answer was " + String.fromCharCode(65 + r.real_index) + ".");
  }
  return "";
}
function shareLink(r, mine) {
  const right = mine.choice === r.real_index;
  const rk = rankOf(myPts()).name;
  const text = (right ? "I spotted the machine" : "The machine fooled me") + " in Spot the Machine, round " + r.id + " (" + TIER[tierOf(r)].name + "). Rank: " + rk + ". Can you tell which answer the attested AI really wrote?";
  const href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(location.origin + location.pathname);
  return el("a", { class: "pbtn", href, target: "_blank", rel: "noopener" }, "Share result");
}
function tickCountdowns() {
  document.querySelectorAll(".count[data-closes]").forEach((n) => {
    const ms = Number(n.dataset.closes) - Date.now();
    if (ms <= 0) { n.textContent = "Guessing just closed."; return; }
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    n.textContent = "Closes in " + (m ? m + "m " : "") + String(s).padStart(m ? 2 : 1, "0") + "s.";
  });
}
setInterval(tickCountdowns, 1000);
// Came back from a redirect wallet? Say so, tidy the address bar, and restore the session.
if (/[?&](transactionHashes|errorCode)=/.test(location.search)) {
  flashMsg = /errorCode=/.test(location.search) ? { kind: "err", text: "The wallet reported an error. Nothing was sent." } : { kind: "ok", text: "Transaction sent. Updating in a few seconds." };
  history.replaceState(null, "", location.pathname + location.hash);
  setTimeout(refresh, 3500);
}
try { if (Object.keys(localStorage).some((k) => k.startsWith("near-wallet-selector"))) loadWallet(); } catch (e) { /* storage blocked: the Connect button still works */ }

// ---------- refresh loop ----------
buildChrome(); decorate();
const live = document.getElementById("live"), livetext = document.getElementById("livetext");
async function refresh() {
  try {
    const [j, r] = await Promise.all([readList(CFG.escrow, "get_job", "job_id", finalJobs), readList(CFG.arena, "get_round", "round_id", finalRounds)]);
    const sellers = [...new Set(j.map((x) => x.seller))];
    const [rp, bl] = await Promise.all([
      Promise.all(sellers.map(async (account) => ({ account, rep: await rpcView(CFG.escrow, "get_reputation", { account_id: account }) }))),
      Promise.all(Object.values(CFG.accounts).map(async (account) => ({ account, balance: await rpcView(CFG.token, "ft_balance_of", { account_id: account }) }))),
    ]);
    jobs = j; rounds = r; reps = rp; bals = bl;
    try { calls = await readCalls(); } catch (e) { calls = []; }
    failures = 0; hasData = true;
    renderAll(); refreshMine(); refreshPass();
    live.className = "live fresh";
    livetext.textContent = "Live from NEAR testnet, updated " + new Date().toLocaleTimeString();
  } catch (e) {
    failures++;
    // One slow answer from the public node is normal. Keep the last data and only say so after repeated misses.
    if (failures >= 3 || !hasData) {
      live.className = "live down";
      livetext.textContent = hasData ? "Reconnecting to NEAR testnet, showing the last data" : "Cannot reach NEAR testnet yet (" + e.message + "). Retrying";
    }
  }
}
($("foot") || document.body).append(link(CFG.escrow, "Escrow contract"), link(CFG.arena, "Arena contract"), link(CFG.token, "Test credits (NSC) token"),
  el("a", { href: "https://github.com/sirmos/nearsay", target: "_blank", rel: "noopener" }, "Source code"));
renderHowto();
renderAll();
refresh();
setInterval(refresh, CFG.refreshMs);
pollBlock(); setInterval(pollBlock, 5000); setInterval(tickTicker, 1000);
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
}));
