// Shared page chrome and visuals: navigation, live strip, engraved line art, arena illustration, passport.
// Everything drawn here is generated from numbers and constants, never from chain text.
const NAV = [["index.html", "Home", "home"], ["jobs.html", "Jobs", "jobs"], ["reputation.html", "Reputation", "reputation"],
  ["arena.html", "Arena", "arena"], ["leaderboard.html", "Leaderboard", "leaderboard"], ["passport.html", "Passport", "passport"]];
const SVGNS = "http://www.w3.org/2000/svg";
const svgFrom = (markup) => { const t = document.createElement("template"); t.innerHTML = markup.trim(); return t.content.firstElementChild; };
const hash32 = (str, seed = 2166136261) => { let h = seed >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };

// ---------- engraving: guilloche rosettes and waves ----------
function rosettePath(R, r, d, step = 0.06) {
  const k = (R - r) / r, turns = r / (function g(a, b) { return b ? g(b, a % b) : a; })(R, r);
  let p = "";
  for (let t = 0, i = 0; t <= turns * 2 * Math.PI; t += step, i++) {
    const x = (R - r) * Math.cos(t) + d * Math.cos(k * t), y = (R - r) * Math.sin(t) - d * Math.sin(k * t);
    p += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }
  return p + "Z";
}
function rosetteSVG(color = "currentColor", layers = [[100, 37, 66], [100, 29, 48], [100, 47, 30]], width = 0.55) {
  const paths = layers.map(([R, r, d], i) => '<path d="' + rosettePath(R, r, d) + '" fill="none" stroke="' + color + '" stroke-width="' + width + '" opacity="' + (1 - i * 0.18) + '"/>').join("");
  return '<svg viewBox="-170 -170 340 340" aria-hidden="true">' + paths + "</svg>";
}
function waveBand(w, h, color, lines = 15) {
  let out = "";
  for (let i = 0; i < lines; i++) {
    let p = "";
    for (let x = 0; x <= w; x += 6) {
      const y = h / 2 + (h * 0.42) * Math.sin(x * 0.045 + i * 0.5) * Math.cos(x * 0.011 + i * 0.21);
      p += (x ? "L" : "M") + x + " " + y.toFixed(1);
    }
    out += '<path d="' + p + '" fill="none" stroke="' + color + '" stroke-width="0.7" opacity="0.6"/>';
  }
  return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' + out + "</svg>";
}
function sealSVG(top, mid, bottom, color) {
  const id = "s" + hash32(top + mid + bottom).toString(36);
  let ticks = "";
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, x1 = 50 + Math.cos(a) * 47, y1 = 50 + Math.sin(a) * 47, x2 = 50 + Math.cos(a) * 44, y2 = 50 + Math.sin(a) * 44; ticks += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>'; }
  return '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="' + color + '" stroke-width="1.2"><circle cx="50" cy="50" r="48"/><circle cx="50" cy="50" r="42"/><circle cx="50" cy="50" r="27" stroke-width=".8"/>' + ticks + '</g>' +
    '<defs><path id="' + id + 't" d="M 50 50 m -35 0 a 35 35 0 1 1 70 0"/><path id="' + id + 'b" d="M 50 50 m -37 0 a 37 37 0 0 0 74 0"/></defs>' +
    '<g fill="' + color + '" font-family="Oxanium,sans-serif" font-weight="700" font-size="8.5" letter-spacing="1.4" text-anchor="middle"><text><textPath href="#' + id + 't" startOffset="50%">' + top + '</textPath></text><text><textPath href="#' + id + 'b" startOffset="50%">' + bottom + '</textPath></text>' +
    '<text x="50" y="56" font-size="19" letter-spacing="0">' + mid + "</text></g></svg>";
}
const CHECK_PATH = "M30 52 L44 66 L72 34";

// ---------- arena illustration ----------
function arenaArt() {
  const ped = [[120, 262, "A"], [225, 286, "B"], [375, 286, "C"], [480, 262, "D"]];
  const peds = ped.map(([x, y, l], i) =>
    '<g transform="translate(' + x + " " + y + ')"><ellipse cx="0" cy="12" rx="40" ry="11" fill="#08111a" opacity=".6"/>' +
    '<rect x="-30" y="-34" width="60" height="46" fill="url(#pillar)"/><ellipse cx="0" cy="12" rx="30" ry="8" fill="#1a2f40"/>' +
    '<ellipse cx="0" cy="-34" rx="30" ry="8" fill="#29465c" stroke="#ffb454" stroke-opacity=".6"/>' +
    '<text x="0" y="-2" text-anchor="middle" font-family="Oxanium,sans-serif" font-weight="700" font-size="26" fill="#ffb454" opacity=".9">' + l + "</text>" +
    '<g class="float f' + (i + 1) + '"><g transform="translate(0 -78)"><circle r="23" fill="#0c151c" stroke="#ffb454" stroke-opacity=".75" stroke-width="1.5"/><circle r="17" fill="none" stroke="#ffb454" stroke-opacity=".25"/>' +
    '<text y="9" text-anchor="middle" font-family="Oxanium,sans-serif" font-weight="700" font-size="27" fill="#ffb454">?</text></g></g></g>').join("");
  const crowd = [[300, 205, 296, 150, "#20384a"], [300, 205, 268, 128, "#1b3040"], [300, 205, 240, 108, "#17283a"]]
    .map(([cx, cy, rx, ry, c]) => '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="none" stroke="' + c + '" stroke-width="13" stroke-dasharray="1 8.5" stroke-linecap="round"/>').join("");
  let spokes = "";
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; spokes += '<line x1="300" y1="274" x2="' + (300 + Math.cos(a) * 250).toFixed(1) + '" y2="' + (274 + Math.sin(a) * 92).toFixed(1) + '"/>'; }
  return '<svg viewBox="0 0 600 380" role="img" aria-label="An arena with four pedestals, each holding a hidden answer"><defs>' +
    '<radialGradient id="floor" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#22394d"/><stop offset="1" stop-color="#0b151e"/></radialGradient>' +
    '<linearGradient id="beamg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb454" stop-opacity=".75"/><stop offset="1" stop-color="#ffb454" stop-opacity="0"/></linearGradient>' +
    '<linearGradient id="pillar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#132330"/><stop offset=".5" stop-color="#25415a"/><stop offset="1" stop-color="#132330"/></linearGradient></defs>' +
    crowd +
    '<polygon class="beam" points="60,-10 110,-10 340,278 150,278" fill="url(#beamg)" opacity=".5"/><polygon class="beam b2" points="540,-10 490,-10 260,278 450,278" fill="url(#beamg)" opacity=".5"/>' +
    '<ellipse cx="300" cy="274" rx="262" ry="96" fill="url(#floor)" stroke="#2c4a60"/><ellipse cx="300" cy="274" rx="206" ry="74" fill="none" stroke="#2c4a60"/><ellipse cx="300" cy="274" rx="150" ry="52" fill="none" stroke="#ffb454" stroke-opacity=".28"/>' +
    '<g stroke="#2c4a60" stroke-width=".6" opacity=".7">' + spokes + "</g>" + peds + "</svg>";
}

// ---------- doors' icons ----------
const ICONS = {
  jobs: '<svg class="ico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5h17l8 8v30H12z"/><path d="M29 5v8h8"/><path d="M18 29l5 5 9-11"/></svg>',
  reputation: '<svg class="ico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M24 4l16 6v12c0 11-7 18-16 22C15 40 8 33 8 22V10z"/><path d="M24 16l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>',
  arena: '<svg class="ico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="24" cy="30" rx="19" ry="8"/><path d="M5 30v-8c0-4 8-8 19-8s19 4 19 8v8"/><circle cx="24" cy="16" r="6"/><path d="M22 14.5c0-1.5 4-1.5 4 0 0 1.5-2 1.5-2 3M24 20v.2"/></svg>',
  board: '<svg class="ico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 42h36"/><rect x="17" y="18" width="14" height="24"/><rect x="3" y="28" width="14" height="14"/><rect x="31" y="32" width="14" height="10"/><path d="M24 6l2 4 4 .5-3 3 .8 4-3.8-2-3.8 2 .8-4-3-3 4-.5z"/></svg>',
  passport: '<svg class="ico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="4" width="30" height="40" rx="3"/><circle cx="24" cy="19" r="7"/><path d="M17 19h14M24 12c-3 3-3 11 0 14M24 12c3 3 3 11 0 14"/><path d="M15 35h18M15 39h12"/></svg>',
  lock: '<svg class="lock" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2"/></svg>',
};
const icon = (name) => svgFrom(ICONS[name]);

// ---------- identity visuals for the passport ----------
function identicon(account) {
  const h = hash32(account), h2 = hash32(account, 99991), hue = h % 360;
  let cells = "";
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if (((h2 >> (y * 3 + x)) & 1) === 0) continue;
    cells += '<rect x="' + (x * 20) + '" y="' + (y * 20) + '" width="20" height="20"/>';
    if (x < 2) cells += '<rect x="' + ((4 - x) * 20) + '" y="' + (y * 20) + '" width="20" height="20"/>';
  }
  return '<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="hsl(' + ((hue + 40) % 360) + ' 25% 90%)"/><g fill="hsl(' + hue + ' 55% 28%)">' + cells + "</g></svg>";
}
function stampSVG(roundId, kind, tier) {
  // kind: right, wrong, pending, void
  const colour = { right: "#0a6b52", wrong: "#b2352b", pending: "#6b7775", void: "#6b7775" }[kind];
  const glyph = { right: '<path d="' + CHECK_PATH + '" fill="none" stroke="' + colour + '" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -4)"/>',
    wrong: '<path d="M36 36 L64 64 M64 36 L36 64" fill="none" stroke="' + colour + '" stroke-width="7" stroke-linecap="round"/>',
    pending: '<circle cx="50" cy="50" r="5" fill="' + colour + '"/><circle cx="34" cy="50" r="3" fill="' + colour + '"/><circle cx="66" cy="50" r="3" fill="' + colour + '"/>',
    void: '<path d="M34 50h32" stroke="' + colour + '" stroke-width="6" stroke-linecap="round"/>' }[kind];
  const label = { right: "SPOTTED", wrong: "FOOLED", pending: "PENDING", void: "VOIDED" }[kind];
  const rot = ((hash32(String(roundId)) % 21) - 10);
  const id = "st" + roundId + kind;
  const dash = kind === "pending" ? ' stroke-dasharray="3 3"' : "";
  return '<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(' + rot + ' 50 50)" opacity=".92"><g fill="none" stroke="' + colour + '"' + dash + '><circle cx="50" cy="50" r="46" stroke-width="2.2"/><circle cx="50" cy="50" r="39" stroke-width=".8"/></g>' +
    '<defs><path id="' + id + 'a" d="M 50 50 m -33 0 a 33 33 0 1 1 66 0"/><path id="' + id + 'b" d="M 50 50 m -35 0 a 35 35 0 0 0 70 0"/></defs>' +
    '<g fill="' + colour + '" font-family="Oxanium,sans-serif" font-weight="700" font-size="9.5" letter-spacing="1.6" text-anchor="middle"><text><textPath href="#' + id + 'a" startOffset="50%">ROUND ' + Number(roundId) + '</textPath></text><text><textPath href="#' + id + 'b" startOffset="50%">' + label + " · " + tier + "</textPath></text></g>" + glyph + "</g></svg>";
}

// ---------- chrome: nav, live strip, footer ----------
function buildChrome() {
  const page = document.body.dataset.page || "home";
  const links = NAV.map(([href, label, key]) => el("a", { href, "aria-current": key === page ? "page" : null }, label));
  const brand = el("a", { class: "brand", href: "index.html" });
  brand.append(svgFrom('<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="7" fill="none" stroke="#4fd6a2" stroke-width="2"/><path d="M7 14.5l4 4 8-10" fill="none" stroke="#4fd6a2" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'), "Nearsay");
  const top = el("header", { class: "topbar" },
    el("div", { class: "wrap bar" }, brand, el("nav", { class: "nav", "aria-label": "Main" }, links),
      el("div", { class: "navright" }, el("span", { class: "live", id: "live" }, el("i"), el("span", { id: "livetext" }, "Connecting to NEAR testnet")),
        el("button", { class: "pbtn", id: "navsign", type: "button" }, "Sign in"))),
    el("div", { class: "ticker", id: "ticker", "aria-label": "Live from the chain" }));
  document.body.prepend(top);
  const foot = el("footer", {}, el("div", { class: "wrap", id: "foot" }));
  document.body.append(foot);
}
function artInto(id, markup) { const n = document.getElementById(id); if (n && !n.firstChild) n.append(svgFrom(markup)); }
function decorate() {
  artInto("rosetteart", rosetteSVG("#4fd6a2"));
  artInto("rosetteart2", rosetteSVG("#ffb454"));
  const a = document.getElementById("arenaart"); if (a && !a.firstChild) a.append(svgFrom(arenaArt()));
}

// ---------- live strip ----------
let blockHeight = null;
async function pollBlock() {
  try {
    const res = await fetch(RPCS[rpcIdx % RPCS.length], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: [] }) });
    const j = await res.json(); blockHeight = j.result.sync_info.latest_block_height;
    document.querySelectorAll(".tkblock").forEach((n) => { n.textContent = "#" + Number(blockHeight).toLocaleString(); });
  } catch (e) { rpcIdx++; }
}
let tickerSig = "";
function renderTicker() {
  const box = document.getElementById("ticker"); if (!box) return;
  const items = [];
  items.push([null, ["NEAR testnet block ", el("b", { class: "tkblock" }, blockHeight ? "#" + Number(blockHeight).toLocaleString() : "…")]]);
  const open = rounds.filter(openNow).sort((a, b) => num(a.closes_ms) - num(b.closes_ms));
  if (open.length) { const r = open[0]; items.push(["amber", ["Round " + r.id + " (" + TIER[tierOf(r)].name + ") closes in ", el("b", { class: "tkc", "data-closes": String(num(r.closes_ms)) }, "")]]); }
  items.push(["amber", [el("b", {}, String(open.length)), open.length === 1 ? " round open now" : " rounds open now"]]);
  const sr = rounds.filter((r) => r.status === "Settled").slice(-1)[0];
  if (sr) items.push(["amber", ["Round " + sr.id + " settled, real answer ", el("b", {}, String.fromCharCode(65 + sr.real_index)), ", " + sr.guesses.length + (sr.guesses.length === 1 ? " guess" : " guesses")]]);
  const sj = jobs.filter((j) => j.status === "Settled").slice(-1)[0];
  if (sj) items.push([null, ["Job #" + sj.id + " settled, ", el("b", {}, credits(String(payoutOf(sj).payout))), " paid to " + nameOf(sj.seller)]]);
  if (pass.pool !== null) items.push(["violet", ["Season prize pool ", el("b", {}, nearOf(pass.pool) + " NEAR")]]);
  const sig = items.map(([c, parts]) => parts.map((p) => (p instanceof Node ? (p.classList.contains("tkblock") || p.classList.contains("tkc") ? "·" : p.textContent) : p)).join("")).join("|");
  if (sig === tickerSig) return;
  tickerSig = sig;
  const group = () => el("div", { class: "grp" }, items.map(([c, parts]) => el("span", {}, el("i", { class: "dot" + (c ? " " + c : "") }), parts.map((p) => (p instanceof Node ? p.cloneNode(true) : p)))));
  box.replaceChildren(el("div", { class: "track" }, group(), group()));
  tickTicker();
}
function tickTicker() {
  document.querySelectorAll(".tkc").forEach((n) => {
    const ms = Number(n.dataset.closes) - Date.now();
    if (ms <= 0) { n.textContent = "now"; return; }
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    n.textContent = (m ? m + "m " : "") + String(s).padStart(2, "0") + "s";
  });
}

// ---------- paging and search for long tables ----------
const UI = {};
function pageOf(key, items, size = 10) {
  const st = (UI[key] = UI[key] || { page: 0, q: "" });
  const pages = Math.max(1, Math.ceil(items.length / size));
  st.page = Math.min(st.page, pages - 1);
  const slice = items.slice(st.page * size, st.page * size + size);
  const pager = el("div", { class: "pager" },
    el("span", {}, items.length ? (st.page * size + 1) + " to " + (st.page * size + slice.length) + " of " + items.length : "No matches"),
    el("button", { class: "pbtn", type: "button", disabled: st.page === 0 ? "" : null, onclick: () => { st.page--; renderAll(); } }, "Previous"),
    el("button", { class: "pbtn", type: "button", disabled: st.page >= pages - 1 ? "" : null, onclick: () => { st.page++; renderAll(); } }, "Next"));
  return { slice, pager, start: st.page * size };
}
function wireSearch(inputId, key) {
  const i = document.getElementById(inputId);
  if (!i || i.dataset.wired) return;
  i.dataset.wired = "1";
  i.addEventListener("input", () => { (UI[key] = UI[key] || { page: 0, q: "" }).q = i.value.trim().toLowerCase(); UI[key].page = 0; renderAll(); });
}
const matches = (key, ...fields) => { const q = (UI[key] && UI[key].q) || ""; return !q || fields.some((f) => String(f).toLowerCase().includes(q)); };

// ---------- doors on the home page ----------
function renderDoors() {
  const box = document.getElementById("doors"); if (!box) return;
  const settled = jobs.filter((j) => j.status === "Settled").length;
  const open = rounds.filter(openNow).length;
  const players = buildBoard(false).length;
  const sellers = reps.filter((r) => r.rep.settled_jobs > 0).length;
  const door = (href, cls, ico, title, text, big, small) => el("a", { class: "door " + cls, href }, el("span", { class: "glow" }), icon(ico), el("h3", {}, title), el("p", {}, text), el("div", { class: "live2" }, el("b", {}, big), small));
  box.replaceChildren(
    door("jobs.html", "w3", "jobs", "Jobs", "Every escrow on testnet, with its receipt and a four-step proof trail from funding to payout.", String(settled), settled === 1 ? "job settled" : "jobs settled"),
    door("reputation.html", "w3", "reputation", "Reputation", "A record built only from escrows that really settled. Repeat deals between the same two accounts stop counting.", String(sellers), sellers === 1 ? "account with a record" : "accounts with a record"),
    door("arena.html", "w2 arenaD", "arena", "Arena", "Spot the Machine. Find the answer an attested AI really wrote, and fool others with your own fakes.", String(open), open === 1 ? "round open" : "rounds open"),
    door("leaderboard.html", "w2 boardD", "board", "Leaderboard", "Ranked players and the liar agents that fooled them most. Recomputable from the chain.", String(players), players === 1 ? "player ranked" : "players ranked"),
    door("passport.html", "w2 passD", "passport", "Passport", "Your stamped record: one stamp for every round you played, with your rank and streak.", me ? "yours" : "open", me ? "see your stamps" : "sign in to get yours"));
}

// ---------- passport ----------
function renderPassport() {
  const box = document.getElementById("passport"); if (!box) return;
  if (!me) {
    box.replaceChildren(el("div", { class: "cover" }, svgFrom(rosetteSVG("#d9c27f", [[100, 37, 66], [100, 29, 48], [100, 53, 36]], 0.5)).cloneNode(true),
      el("div", { class: "in" }, svgFrom(sealSVG("NEARSAY", "N", "PASSPORT", "#e9d7a6")), el("h2", {}, "PASSPORT"), el("p", {}, "of the Arena"))));
    const bg = box.querySelector(".cover > svg"); if (bg) bg.classList.add("bg");
    const crest = box.querySelector(".in svg"); if (crest) crest.classList.add("crest");
    return;
  }
  const all = buildBoard(true), mine = all.find((x) => x.player === me);
  const pts = mine ? mine.points : 0, rk = rankOf(pts), span = rk.next ? rk.next[1] - rk.floor : 1;
  const stamps = [];
  for (const r of rounds.slice().sort((a, b) => a.id - b.id)) {
    const g = r.guesses.find((x) => playerOf(x) === me);
    if (!g) continue;
    const kind = r.status === "Voided" ? "void" : r.status === "Open" ? "pending" : g.choice === r.real_index ? "right" : "wrong";
    stamps.push({ r, kind, tier: TIER[tierOf(r)].name.toUpperCase() });
  }
  const firstClose = stamps.length ? new Date(num(stamps[0].r.closes_ms)) : new Date();
  const no = "NS-" + hash32(me).toString(16).toUpperCase().padStart(8, "0");
  const pad = (s, n = 44) => (s + "<".repeat(n)).slice(0, n);
  const clean = me.toUpperCase().replace(/\.TESTNET$/, "").replace(/[^A-Z0-9]/g, "<");
  const fld = (label, value, wide) => el("div", { class: "fld" + (wide ? " wide" : "") }, el("small", {}, label), el("b", {}, value));
  const wm = el("div", { class: "wm" }); wm.append(svgFrom(rosetteSVG("#0a6b52")));
  const wm2 = el("div", { class: "wm" }); wm2.append(svgFrom(rosetteSVG("#0a6b52", [[100, 41, 60], [100, 31, 44]])));
  const photo = el("div", { class: "photo" }); photo.append(svgFrom(identicon(me)));
  const seal = el("div", { class: "rankseal" }); seal.append(svgFrom(sealSVG("NEARSAY", rk.name.slice(0, 1), rk.name.toUpperCase(), "#0a6b52")));
  const sheet = el("div", { class: "ppage" });
  const stampBox = el("div", { class: "stamps" });
  stamps.forEach((s) => { const d = el("div", { class: "stamp", title: "Round " + s.r.id }); d.append(svgFrom(stampSVG(s.r.id, s.kind, s.tier))); stampBox.append(d); });
  const share = "https://twitter.com/intent/tweet?text=" + encodeURIComponent("I hold a " + rk.name + " passport in Nearsay with " + pts + " points. Can you spot the machine?") + "&url=" + encodeURIComponent(location.origin + location.pathname.replace(/passport\.html$/, "arena.html"));
  box.replaceChildren(el("div", { class: "booklet" },
    el("div", { class: "ppage" }, wm, seal,
      el("div", { class: "ptitle" }, el("b", {}, "PASSPORT"), el("span", {}, "Nearsay Arena")),
      el("div", { class: "idrow" }, photo,
        el("div", { class: "fields" }, fld("Account", me, true), fld("Passport no.", no), fld("Rank", rk.name), fld("Points", String(pts)), fld("First stamp", firstClose.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })))),
      el("div", { class: "pprog" }, el("small", {}, rk.next ? (rk.next[1] - pts) + " points to " + rk.next[0] : "Top rank reached"), el("div", { class: "bar2" }, el("i", { style: "width:" + (rk.next ? Math.min(100, ((pts - rk.floor) / span) * 100) : 100) + "%" }))),
      el("div", { class: "pstats" },
        el("div", {}, el("b", {}, String(mine ? mine.played : 0)), el("span", {}, "rounds")),
        el("div", {}, el("b", {}, mine ? Math.round((mine.correct / mine.played) * 100) + "%" : "0%"), el("span", {}, "accuracy")),
        el("div", {}, el("b", {}, String(mine ? mine.streak : 0)), el("span", {}, "streak")),
        el("div", {}, el("b", {}, pass.mine ? "Yes" : "No"), el("span", {}, "season pass"))),
      el("div", { class: "mrz" }, el("div", {}, pad("P<NSY" + clean)), el("div", {}, pad(no.replace("-", "") + "<" + rk.name.toUpperCase() + "<" + String(pts).padStart(4, "0"))))),
    el("div", { class: "ppage" }, wm2,
      el("div", { class: "ptitle" }, el("b", {}, "STAMPS"), el("span", {}, stamps.length + (stamps.length === 1 ? " round" : " rounds"))),
      stamps.length ? stampBox : el("p", { class: "stamps-empty" }, "No stamps yet. Play a round in the Arena and your first stamp lands here."),
      el("div", { style: "margin-top:18px; display:flex; gap:8px; flex-wrap:wrap" }, el("a", { class: "pbtn go", href: "arena.html#play" }, "Go to the Arena"), el("a", { class: "pbtn", style: "color:#1c2a2b;border-color:#8aa", href: share, target: "_blank", rel: "noopener" }, "Share my passport")))));
}
