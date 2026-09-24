import { HEROES } from "./lib/heroes.js";
import { validateMatch } from "./lib/validate.js";
import { withDerived, playerLeaderboard, heroStats } from "./lib/stats.js";
import { submitMatch, listMatches, getMatch } from "./lib/store.js";
import { parseScreenshots } from "./lib/ocr/parse.js";
import { createBrowserEngine } from "./lib/ocr/engine-browser.js";

const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString());
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const dur = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const when = (d) => (d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

const pageHead = (kicker, title, sub = "") => `
  <header class="page-head reveal">
    <div class="kicker" style="--i:0">${kicker}</div>
    <h1 style="--i:1">${title}</h1>
    ${sub ? `<p style="--i:2">${sub}</p>` : ""}
  </header>`;
const loading = (kicker, title) => `${pageHead(kicker, title)}<div class="panel empty">Loading…</div>`;

const STATS = [
  ["level", "Lvl"], ["kills", "K"], ["deaths", "D"], ["assists", "A"], ["net_worth", "Net worth"],
  ["last_hits", "LH"], ["denies", "DN"], ["gpm", "GPM"], ["xpm", "XPM"],
  ["hero_damage", "Hero dmg"], ["hero_healing", "Heal"],
];

// League data is small; load it once per visit and refresh after uploads.
let matchesCache = null;
async function allMatches(force = false) {
  if (!matchesCache || force) matchesCache = (await listMatches()).map(withDerived);
  return matchesCache;
}

function errorBox(e) {
  console.error(e);
  const offline = e?.code === "unavailable" || /network|fetch/i.test(e?.message ?? "");
  return `<div class="notice err">${offline ? "Couldn't reach the league database. Check your connection and reload." : esc(e?.message ?? "Something went wrong.")}</div>`;
}

// ---------- Upload + review ----------

const engine = createBrowserEngine();
const upload = { images: [], draft: null, check: null, notes: [], busy: false, progress: "", message: null };

function blankDraft() {
  const player = (team) => ({ team, name: "", tag: "", hero: "", ...Object.fromEntries(STATS.map(([k]) => [k, null])) });
  return {
    team_a: "", team_b: "", score_a: null, score_b: null, winner: null, duration: "", game_mode: "Captains Mode",
    players: [...Array(5)].map(() => player("a")).concat([...Array(5)].map(() => player("b"))),
  };
}

function addFiles(files) {
  const imgs = [...files].filter((f) => f.type.startsWith("image/"));
  if (!imgs.length) return;
  for (const f of imgs) upload.images.push({ file: f, url: URL.createObjectURL(f), name: f.name || "pasted image" });
  while (upload.images.length > 2) URL.revokeObjectURL(upload.images.shift().url);
  upload.message = null;
  engine.warmUp();
  renderUpload();
}

// Snipping Tool: Win+Shift+S, then Ctrl+V anywhere on the upload page.
document.addEventListener("paste", (e) => {
  if (!location.hash.startsWith("#/upload") || e.target.closest?.("input")) return;
  const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
  if (files.length) { e.preventDefault(); addFiles(files); }
});

async function runParse() {
  upload.busy = true;
  upload.message = null;
  upload.progress = "Loading the text reader (first time takes a few seconds)…";
  renderUpload();
  try {
    const { match, notes } = await parseScreenshots(engine, upload.images.map((i) => i.file), {
      onProgress: (msg) => { upload.progress = msg; const el = document.getElementById("progress"); if (el) el.textContent = msg; },
    });
    upload.draft = match;
    upload.notes = notes;
    upload.check = validateMatch(match);
    upload.message = { kind: "ok", text: "Done. Check every value against your screenshots: red boxes couldn't be read." };
  } catch (e) {
    console.error(e);
    upload.message = { kind: "err", text: `Couldn't read the screenshots: ${e.message}. You can still enter the game manually.` };
  }
  upload.busy = false;
  renderUpload();
}

function revalidate() {
  upload.check = validateMatch(upload.draft);
  renderChecks();
}

function checksHtml(check) {
  if (!check) return "";
  let h = "";
  if (check.errors?.length) h += `<div class="notice err"><b>Fix before saving:</b><ul>${check.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`;
  if (check.warnings?.length) h += `<div class="notice warn"><b>Double-check:</b><ul>${check.warnings.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`;
  if (check.ok && !check.warnings?.length) h += `<div class="notice ok">All checks pass. Kills match scores on both sides.</div>`;
  return h;
}

function renderChecks() {
  const el = document.getElementById("checks");
  if (el) el.innerHTML = checksHtml(upload.check);
  const save = document.getElementById("save");
  if (save) save.disabled = !upload.check?.ok || upload.busy;
}

function numInput(path, v) {
  return `<input class="num${v == null ? " bad" : ""}" data-path="${path}" data-type="int" inputmode="numeric" value="${v ?? ""}">`;
}

function textInput(path, v, attrs = "") {
  return `<input class="${v ? "" : "bad"}" data-path="${path}" value="${esc(v)}" ${attrs}>`;
}

function draftHtml(d) {
  const teamRows = (t) =>
    d.players.map((p, i) => [p, i]).filter(([p]) => p.team === t).map(([p, i]) => `
      <tr class="team-${t}">
        <td class="l">${textInput(`players.${i}.name`, p.name, 'list="player-list" placeholder="name" style="min-width:130px"')}</td>
        <td class="l"><input data-path="players.${i}.tag" value="${esc(p.tag)}" placeholder="optional" style="width:80px"></td>
        <td class="l">${textInput(`players.${i}.hero`, p.hero, 'list="hero-list" placeholder="hero" style="min-width:140px"')}</td>
        ${STATS.map(([k]) => `<td>${numInput(`players.${i}.${k}`, p[k])}</td>`).join("")}
      </tr>`).join("");

  return `
    <h2>Review</h2>
    <div class="panel edit">
      <div class="fields">
        <label>Team A (first / left)${textInput("team_a", d.team_a)}</label>
        <label>Team A score${numInput("score_a", d.score_a)}</label>
        <label>Team B (second / right)${textInput("team_b", d.team_b)}</label>
        <label>Team B score${numInput("score_b", d.score_b)}</label>
        <label>Winner
          <select data-path="winner" class="${d.winner ? "" : "bad"}">
            <option value="" ${!d.winner ? "selected" : ""}>—</option>
            <option value="a" ${d.winner === "a" ? "selected" : ""}>Team A</option>
            <option value="b" ${d.winner === "b" ? "selected" : ""}>Team B</option>
          </select></label>
        <label>Duration (mm:ss)${textInput("duration", d.duration, 'placeholder="44:43"')}</label>
        <label>Game mode<input data-path="game_mode" value="${esc(d.game_mode)}"></label>
      </div>
    </div>
    ${upload.notes.length ? `<div class="notice warn"><b>Reader notes:</b><ul>${upload.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
    <div class="table-wrap edit" style="margin-top:12px">
      <table>
        <thead><tr><th class="l">Player</th><th class="l">Tag</th><th class="l">Hero</th>${STATS.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead>
        <tbody>
          <tr class="sep a"><td colspan="${STATS.length + 3}">Team A</td></tr>${teamRows("a")}
          <tr class="sep b"><td colspan="${STATS.length + 3}">Team B</td></tr>${teamRows("b")}
        </tbody>
      </table>
    </div>
    <div id="checks">${checksHtml(upload.check)}</div>
    <div class="row" style="margin-top:12px">
      <button class="primary" id="save" ${upload.check?.ok ? "" : "disabled"}>Save to league</button>
      <button id="discard">Discard</button>
    </div>`;
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

function onDraftInput(e) {
  const el = e.target;
  if (!el.dataset.path) return;
  let v = el.value;
  if (el.dataset.type === "int") {
    const cleaned = v.replace(/[,\s]/g, "");
    v = /^\d+$/.test(cleaned) ? Number(cleaned) : null;
    el.classList.toggle("bad", v == null);
  } else if (el.dataset.path === "winner") {
    v = v || null;
    el.classList.toggle("bad", !v);
  } else if (el.classList.contains("bad") || !v) {
    el.classList.toggle("bad", !v.trim());
  }
  setPath(upload.draft, el.dataset.path, v);
  revalidate();
}

async function saveDraft() {
  const save = document.getElementById("save");
  save.disabled = true;
  save.textContent = "Saving…";
  try {
    const res = await submitMatch(upload.check.match);
    if (res.duplicateOf) {
      upload.message = { kind: "warn", text: "This game is already in the league.", link: `#/match/${res.duplicateOf}` };
      renderUpload();
      return;
    }
    for (const img of upload.images) URL.revokeObjectURL(img.url);
    Object.assign(upload, { images: [], draft: null, check: null, notes: [], message: null });
    await allMatches(true);
    location.hash = `#/match/${res.id}`;
  } catch (e) {
    upload.message = { kind: "err", text: `Couldn't save: ${e.message}` };
    renderUpload();
  }
}

function renderUpload() {
  const msg = upload.message;
  const slot = (i) => {
    const img = upload.images[i];
    return img
      ? `<div class="slot filled" style="--i:${i + 3}"><img src="${img.url}" alt="Screenshot ${i + 1}" title="${esc(img.name)}"><span class="slot-tag">Screenshot ${i + 1}</span></div>`
      : `<div class="slot" style="--i:${i + 3}"><div><div class="slot-num">0${i + 1}</div>
           <div class="slot-label">${i === 0 ? "Overview or Scoreboard" : "The other one"}</div>
           <div class="slot-hint">Paste · drop · click</div></div></div>`;
  };
  app.innerHTML = `
    ${pageHead("Post-game intake", "Upload a scrim",
      `Snip the post-game <b>overview</b> (hero cards) and the <b>Scoreboard</b> tab with <kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>,
       then press <kbd>Ctrl</kbd>+<kbd>V</kbd> here — once for each. Don't hover over anything while snipping; tooltips cover numbers.
       Screenshots are read on your computer; only the stats you save are uploaded.`)}
    <div class="reveal">
      <div class="slots" id="drop" style="--i:3">${slot(0)}${slot(1)}
        <input type="file" id="file" accept="image/*" multiple hidden></div>
      <div class="row upload-actions" style="--i:4">
        <button class="primary" id="parse" ${!upload.images.length || upload.busy ? "disabled" : ""}>Read screenshots</button>
        <button id="manual" ${upload.busy ? "disabled" : ""}>Enter manually</button>
        ${upload.images.length && !upload.busy ? `<button id="clear">Clear</button>` : ""}
      </div>
      ${upload.busy ? `<p class="progress" id="progress">${esc(upload.progress)}</p>` : ""}
    </div>
    ${msg ? `<div class="notice ${msg.kind}">${esc(msg.text)}${msg.link ? ` <a href="${msg.link}">Open it</a>` : ""}</div>` : ""}
    ${upload.draft ? draftHtml(upload.draft) : ""}
    <dialog id="zoom"><img alt=""></dialog>`;

  const drop = document.getElementById("drop");
  const file = document.getElementById("file");
  const zoom = document.getElementById("zoom");
  drop.querySelectorAll(".slot").forEach((s) => {
    s.onclick = () => {
      const img = s.querySelector("img");
      if (img) { zoom.querySelector("img").src = img.src; zoom.showModal(); } else file.click();
    };
  });
  file.onchange = () => addFiles(file.files);
  drop.ondragover = (e) => { e.preventDefault(); drop.querySelectorAll(".slot:not(.filled)").forEach((s) => s.classList.add("over")); };
  drop.ondragleave = () => drop.querySelectorAll(".slot").forEach((s) => s.classList.remove("over"));
  drop.ondrop = (e) => { e.preventDefault(); drop.ondragleave(); addFiles(e.dataTransfer.files); };
  zoom.onclick = () => zoom.close();

  document.getElementById("parse").onclick = runParse;
  document.getElementById("manual").onclick = () => { upload.draft = blankDraft(); upload.notes = []; upload.message = null; upload.check = validateMatch(upload.draft); renderUpload(); };
  const clear = document.getElementById("clear");
  if (clear) clear.onclick = () => { for (const i of upload.images) URL.revokeObjectURL(i.url); upload.images = []; renderUpload(); };

  if (upload.draft) {
    document.getElementById("save").onclick = saveDraft;
    document.getElementById("discard").onclick = () => { upload.draft = null; upload.check = null; upload.notes = []; renderUpload(); };
  }
}

// ---------- Matches ----------

async function renderMatches() {
  app.innerHTML = loading("The ledger", "Matches");
  let data;
  try { data = await allMatches(); } catch (e) { app.innerHTML = `${pageHead("The ledger", "Matches")}${errorBox(e)}`; return; }
  const count = `${data.length} ${data.length === 1 ? "game" : "games"} on record`;
  app.innerHTML = `
    ${pageHead("The ledger", "Matches", data.length ? count : "")}
    ${data.length ? `<div class="fixtures reveal">${data.map((m, i) => `
      <a class="fixture win-${m.winner}" href="#/match/${m.id}" style="--i:${Math.min(i, 12)}">
        <div class="fx-team a ${m.winner === "a" ? "" : "lost"}">${esc(m.team_a)}${m.winner === "a" ? "<small>Victory</small>" : ""}</div>
        <div class="fx-score">
          <div class="n">${m.score_a}<i>/</i>${m.score_b}</div>
          <div class="meta">${dur(m.duration_sec)} · ${when(m.createdAt)}</div>
        </div>
        <div class="fx-team b ${m.winner === "b" ? "" : "lost"}">${esc(m.team_b)}${m.winner === "b" ? "<small>Victory</small>" : ""}</div>
      </a>`).join("")}</div>`
    : `<div class="panel empty"><strong>No games yet</strong>The ledger is empty. <a href="#/upload">Upload the first scrim</a>.</div>`}`;
}

async function renderMatch(id) {
  app.innerHTML = `<div class="panel empty">Loading…</div>`;
  let raw;
  try { raw = matchesCache?.find((m) => m.id === id) ?? (await getMatch(id)); } catch (e) { app.innerHTML = errorBox(e); return; }
  if (!raw) { app.innerHTML = `<div class="notice err">No such match.</div>`; return; }
  const m = raw.teamTotals ? raw : withDerived(raw);

  const best = (k) => Math.max(...m.players.map((p) => p[k] ?? -Infinity));
  const cols = [
    ["kills", "K"], ["deaths", "D"], ["assists", "A"], ["net_worth", "Net worth", fmt], ["last_hits", "LH"],
    ["gpm", "GPM"], ["xpm", "XPM"], ["hero_damage", "Hero dmg", fmt], ["dmg_per_min", "Dmg/min", fmt],
    ["dmg_per_1k_nw", "Dmg per 1k NW", fmt], ["dmg_share", "Dmg share", pct], ["kill_participation", "KP", pct], ["hero_healing", "Heal", fmt],
  ];
  const highlight = new Set(["kills", "net_worth", "gpm", "hero_damage", "dmg_per_min", "dmg_per_1k_nw", "kill_participation", "hero_healing"]);
  const rows = (t) => m.players.filter((p) => p.team === t).map((p) => `
    <tr class="team-${t}">
      <td class="l">${esc(p.name)}${p.tag ? ` <span class="tag">[${esc(p.tag)}]</span>` : ""}</td>
      <td class="l">${esc(p.hero)}</td>
      ${cols.map(([k, , f]) => `<td class="${highlight.has(k) && p[k] === best(k) && p[k] > 0 ? "best" : ""}">${(f ?? ((x) => x))(p[k])}</td>`).join("")}
    </tr>`).join("");

  const top = (k, f) => { const p = [...m.players].sort((x, y) => (y[k] ?? 0) - (x[k] ?? 0))[0]; return { p, v: f(p[k]) }; };
  const cards = [
    ["Most hero damage", top("hero_damage", fmt)],
    ["Best damage per 1k net worth", top("dmg_per_1k_nw", fmt)],
    ["Highest kill participation", top("kill_participation", pct)],
    ["Richest", top("net_worth", fmt)],
  ];
  const ta = m.teamTotals.a.hero_damage, tb = m.teamTotals.b.hero_damage;

  const plate = (t) => {
    const won = m.winner === t;
    return `<div class="plate ${t} ${won ? "" : "lost"}">
      <div class="top-line"><span class="side">${t === "a" ? "Team A" : "Team B"}</span>${won ? '<span class="win-badge">Victory</span>' : ""}</div>
      <div class="team">${esc(t === "a" ? m.team_a : m.team_b)}</div>
      <div class="n">${t === "a" ? m.score_a : m.score_b}</div>
    </div>`;
  };

  app.innerHTML = `
    <div class="kicker" style="margin-bottom:16px"><a href="#/">← The ledger</a></div>
    <section class="banner">
      ${plate("a")}${plate("b")}
      <div class="banner-meta">${esc(m.game_mode || "Match")} · <b>${dur(m.duration_sec)}</b></div>
    </section>
    <h2>Standouts</h2>
    <div class="cards reveal">${cards.map(([k, { p, v }], i) => `<div class="card" style="--i:${i}"><div class="k">${k}</div><div class="v">${v}</div><div class="s"><b>${esc(p.name)}</b> · ${esc(p.hero)}</div></div>`).join("")}
      <div class="card" style="--i:4"><div class="k">Team hero damage</div><div class="v pair">${fmt(ta)} <span class="muted">/</span> ${fmt(tb)}</div>
        <div class="s">${(ta > tb) === (m.winner === "a") ? "Winner out-damaged the loser" : "Loser out-damaged the winner"}</div></div>
    </div>
    <h2>Scoreboard</h2>
    <div class="table-wrap"><table>
      <thead><tr><th class="l">Player</th><th class="l">Hero</th>${cols.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead>
      <tbody>
        <tr class="sep a"><td colspan="${cols.length + 2}">${esc(m.team_a)}</td></tr>${rows("a")}
        <tr class="sep b"><td colspan="${cols.length + 2}">${esc(m.team_b)}</td></tr>${rows("b")}
      </tbody></table></div>
    <p class="table-note">▲ best in match. Dmg/min = hero damage ÷ minutes. Dmg per 1k NW = hero damage per 1,000 net worth (efficiency). KP = (kills + assists) ÷ team score.
      Uploaded ${when(m.createdAt)}. Wrong? Ask the league admin to remove it.</p>`;
}

// ---------- Leaderboards ----------

// columns: [key, label, format?, class?, bar colour?]. A bar colour draws a thin bar under
// the value, scaled to the column's highest value.
function sortableTable(el, columns, rows, sortKey) {
  let key = sortKey, dir = -1;
  const max = Object.fromEntries(columns.filter((c) => c[4]).map(([k]) => [k, Math.max(...rows.map((r) => r[k] ?? 0)) || 1]));
  const cell = ([k, , f, cls, bar], r) => {
    const barCls = bar ? ` bar ${bar}` : "";
    const style = bar ? ` style="--w:${Math.max(0, (r[k] ?? 0) / max[k]).toFixed(3)}"` : "";
    return `<td class="${cls ?? ""}${barCls}"${style}>${f ? f(r[k], r) : esc(r[k])}</td>`;
  };
  const draw = () => {
    const sorted = [...rows].sort((a, b) => {
      const x = a[key], y = b[key];
      if (typeof x === "string") return dir * -x.localeCompare(y);
      return dir * ((x ?? -Infinity) - (y ?? -Infinity));
    });
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th class="rank">#</th>${columns.map(([k, label, , cls]) => `<th class="sortable ${cls ?? ""}${k === key ? " sorted" : ""}" data-k="${k}">${label}${k === key ? (dir < 0 ? " ▾" : " ▴") : ""}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map((r, i) => `<tr><td class="rank${i < 3 ? " top" : ""}">${String(i + 1).padStart(2, "0")}</td>${columns.map((c) => cell(c, r)).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
    el.querySelectorAll("th").forEach((th) => (th.onclick = () => {
      if (th.dataset.k === key) dir = -dir; else { key = th.dataset.k; dir = -1; }
      draw();
    }));
  };
  draw();
}

async function renderPlayers() {
  app.innerHTML = loading("Individual records", "Players");
  let matches;
  try { matches = await allMatches(); } catch (e) { app.innerHTML = `${pageHead("Individual records", "Players")}${errorBox(e)}`; return; }
  const data = playerLeaderboard(matches);
  app.innerHTML = `${pageHead("Individual records", "Players", data.length ? `${data.length} players across ${matches.length} ${matches.length === 1 ? "game" : "games"}. Click a column to sort.` : "")}
    ${data.length ? `<div id="t" class="reveal"></div>
    <p class="table-note">GPM, XPM, Dmg/min and Dmg per 1k NW are totals across all games, not averages of averages. Players are matched by name. Bars compare against the column's best.</p>`
    : `<div class="panel empty"><strong>No players yet</strong><a href="#/upload">Upload a scrim</a> to start the table.</div>`}`;
  if (!data.length) return;
  sortableTable(document.getElementById("t"), [
    ["name", "Player", (v) => esc(v), "l"], ["games", "Games"], ["win_rate", "Win %", pct, "", "jade"],
    ["kills", "K"], ["deaths", "D"], ["assists", "A"], ["kda", "KDA", (v) => v.toFixed(2), "", "jade"],
    ["avg_gpm", "GPM", null, "", "gold"], ["avg_xpm", "XPM"], ["dmg_per_min", "Dmg/min", fmt, "", "ember"], ["dmg_per_1k_nw", "Dmg per 1k NW", fmt, "", "ember"],
    ["avg_kp", "Avg KP", pct], ["heroes", "Heroes", (v) => esc(v), "l"],
  ], data, "games");
}

async function renderHeroes() {
  app.innerHTML = loading("The draft", "Heroes");
  let matches;
  try { matches = await allMatches(); } catch (e) { app.innerHTML = `${pageHead("The draft", "Heroes")}${errorBox(e)}`; return; }
  const rows = heroStats(matches);
  app.innerHTML = `${pageHead("The draft", "Heroes", rows.length ? `${rows.length} heroes picked across ${matches.length} ${matches.length === 1 ? "game" : "games"}.` : "")}
    ${rows.length ? `<div id="t" class="reveal"></div>` : `<div class="panel empty"><strong>No picks yet</strong><a href="#/upload">Upload a scrim</a> to fill the draft table.</div>`}`;
  if (!rows.length) return;
  sortableTable(document.getElementById("t"), [
    ["hero", "Hero", (v) => esc(v), "l"], ["picks", "Picks", null, "", "gold"], ["pick_rate", "Pick rate", pct], ["wins", "Wins"],
    ["win_rate", "Win %", pct, "", "jade"], ["avg_damage", "Avg hero dmg", fmt, "", "ember"], ["avg_kda", "Avg KDA"],
  ], rows, "picks");
}

// ---------- Router ----------

function route() {
  const h = location.hash || "#/";
  const matchId = /^#\/match\/([0-9a-f]{32})$/.exec(h)?.[1];
  const section = matchId ? "matches" : h.startsWith("#/upload") ? "upload" : h.startsWith("#/players") ? "players" : h.startsWith("#/heroes") ? "heroes" : "matches";
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === section));
  if (matchId) return renderMatch(matchId);
  if (section === "upload") return renderUpload();
  if (section === "players") return renderPlayers();
  if (section === "heroes") return renderHeroes();
  return renderMatches();
}

document.getElementById("hero-list").innerHTML = HEROES.map((h) => `<option value="${esc(h)}">`).join("");
// Known player names help fix OCR misreads in the review form.
allMatches().then((ms) => {
  const names = [...new Set(ms.flatMap((m) => m.players.map((p) => p.name)))].sort();
  document.getElementById("player-list").innerHTML = names.map((n) => `<option value="${esc(n)}">`).join("");
}).catch(() => {});
app.addEventListener("input", (e) => { if (upload.draft && e.target.closest(".edit")) onDraftInput(e); });
window.addEventListener("hashchange", route);
route();
