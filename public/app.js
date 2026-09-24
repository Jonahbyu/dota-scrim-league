import { HEROES } from "./lib/heroes.js";
import { validateMatch } from "./lib/validate.js";
import { withDerived, playerLeaderboard, heroStats, hasDetails, playerKey, playerHistory, heroHistory, heroSlug } from "./lib/stats.js";
import { tierList, rankLabel, MIN_GAMES, K_PRIOR } from "./lib/tiers.js";
import { heroImg } from "./lib/hero-meta.js";
import { listTeams, teamHistory, teamSlug, sideOf } from "./lib/teams.js";
import { hasTimeline, swings, teamTimeline, goldCurves, byPlayer, byHero, BIG_LEAD } from "./lib/timeline.js";
import { leadChart, lineChart, wireCharts } from "./lib/charts.js";
import { buildPlayerIndex, matchPlayers } from "./lib/players.js";
import { strengthOfSchedule } from "./lib/schedule.js";
import { submitMatch, listMatches, getMatch, deleteMatch, currentUid } from "./lib/store.js";
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
// A team name that opens the team's page. AD2L teams by PlayOn id (looked up by name when
// only the name is known); scrim teams by name. Inside something that's already a link
// (a match card), nested=true gives a span handled by the click listener at the bottom.
function teamHref(src, name, id = null) {
  if (!name) return null;
  if (src.key === "ad2l") {
    id ??= ad2lCache?.teams.find((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase())?.id;
    return id != null ? `#/ad2l/teams/${id}` : null;
  }
  return `#/teams/${teamSlug(name)}`;
}
function teamLink(src, name, id = null, nested = false) {
  const href = teamHref(src, name, id);
  if (!href) return esc(name ?? "");
  return nested
    ? `<span class="team-link" role="link" tabindex="0" data-href="${href}">${esc(name)}</span>`
    : `<a class="team-link" href="${href}">${esc(name)}</a>`;
}
// A player name that opens their page (same nested rule as teamLink).
const playerHref = (src, key) => `${src.key === "ad2l" ? "#/ad2l/player/" : "#/player/"}${encodeURIComponent(key)}`;
function playerLink(src, p, nested = false, label = null) {
  const href = playerHref(src, p.key ?? playerKey(p));
  const text = label ?? esc(p.name);
  return nested
    ? `<span class="player-link" role="link" tabindex="0" data-href="${href}">${text}</span>`
    : `<a class="player-link" href="${href}">${text}</a>`;
}
// A hero name that opens the hero's page (same nested rule as teamLink).
const heroHref = (src, hero) => `${src.key === "ad2l" ? "#/ad2l/hero/" : "#/hero/"}${heroSlug(hero)}`;
function heroLink(src, hero, nested = false) {
  const href = heroHref(src, hero);
  return nested
    ? `<span class="hero-link" role="link" tabindex="0" data-href="${href}">${esc(hero)}</span>`
    : `<a class="hero-link" href="${href}">${esc(hero)}</a>`;
}
// Short gold figure: 8,200 -> "8.2k".
const kg = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));
const GOLD_NOTE = "Gold = total gold earned per minute from the replay (OpenDota's graph); gold lost on death isn't subtracted, so it can differ from final net worth.";

// Average gold curve for one player or hero against the division's core and support averages.
function goldCurveSection(matches, match, what) {
  const c = goldCurves(matches, match);
  if (c.games < 1 || c.mine.length < 2) return "";
  return `<h2>Gold over time</h2>
    ${lineChart([
      { label: what, values: c.mine, cls: "s-mine", strong: true },
      { label: "Average core", values: c.core, cls: "s-ref", dash: true },
      { label: "Average support", values: c.support, cls: "s-ref2", dash: true },
    ], { caption: `Average gold at each minute over ${c.games} game${c.games === 1 ? "" : "s"}, against the division's average core and support. Hover for values.` })}
    <p class="table-note">${GOLD_NOTE}</p>`;
}

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
const upload = { images: [], draft: null, check: null, notes: [], names: [], busy: false, progress: "", message: null, isPrivate: false };
// Private uploads only need a valid result; public ones need every player too.
const checkDraft = (d) => validateMatch(d, { resultOnly: upload.isPrivate });

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
    upload.names = await fixNames(match);
    upload.check = checkDraft(match);
    upload.message = { kind: "ok", text: "Done. Check every value against your screenshots: red boxes couldn't be read." };
  } catch (e) {
    console.error(e);
    upload.message = { kind: "err", text: `Couldn't read the screenshots: ${e.message}. You can still enter the game manually.` };
  }
  upload.busy = false;
  renderUpload();
}

// Known players: the AD2L Champion rosters (plus stand-ins) and names from saved scrims.
async function playerIndex() {
  const [ad2l, scrims] = await Promise.all([ad2lData().catch(() => null), allMatches().catch(() => [])]);
  return buildPlayerIndex(ad2l, scrims);
}

// Fix clear misreads of known names in place; return every match for the review form
// (fixed ones to show what changed, loose ones as suggestions to accept or ignore).
async function fixNames(match) {
  const found = matchPlayers(match.players, await playerIndex());
  for (const f of found) if (f.sure) match.players[f.i].name = f.to;
  return found;
}

function namesHtml(names) {
  if (!names.length) return "";
  const fixed = names.filter((n) => n.sure), maybe = names.filter((n) => !n.sure);
  const team = (n) => n.teams.length ? ` <span class="muted">(${esc(n.teams.join(" / "))})</span>` : "";
  return `<div class="notice ok names"><b>Known players:</b><ul>
    ${fixed.map((n) => `<li>Read “${esc(n.from)}”, matched to <strong>${esc(n.to)}</strong>${team(n)}</li>`).join("")}
    ${maybe.map((n, k) => `<li>“${esc(n.from)}” might be <strong>${esc(n.to)}</strong>${team(n)}
      <button class="small" data-name-fix="${k}">Use ${esc(n.to)}</button></li>`).join("")}
  </ul></div>`;
}

function revalidate() {
  upload.check = checkDraft(upload.draft);
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
    ${namesHtml(upload.names)}
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
    <label class="private-toggle">
      <input type="checkbox" id="private" ${upload.isPrivate ? "checked" : ""}>
      <span><b>Private — post the result only.</b> Teams, winner, kill score and duration are saved.
        Heroes, players and stats never leave this browser, so nothing about your drafts or lineups is shared.</span>
    </label>
    <div class="row" style="margin-top:12px">
      <button class="primary" id="save" ${upload.check?.ok ? "" : "disabled"}>${upload.isPrivate ? "Post private result" : "Save to league"}</button>
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
    const res = await submitMatch(upload.check.match, { isPrivate: upload.isPrivate });
    if (res.duplicateOf) {
      upload.message = { kind: "warn", text: "This game is already in the league.", link: `#/match/${res.duplicateOf}` };
      renderUpload();
      return;
    }
    for (const img of upload.images) URL.revokeObjectURL(img.url);
    Object.assign(upload, { images: [], draft: null, check: null, notes: [], names: [], message: null });
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
  document.getElementById("manual").onclick = () => { upload.draft = blankDraft(); upload.notes = []; upload.names = []; upload.message = null; upload.check = checkDraft(upload.draft); renderUpload(); };
  const clear = document.getElementById("clear");
  if (clear) clear.onclick = () => { for (const i of upload.images) URL.revokeObjectURL(i.url); upload.images = []; renderUpload(); };

  if (upload.draft) {
    document.getElementById("save").onclick = saveDraft;
    document.getElementById("private").onchange = (e) => { upload.isPrivate = e.target.checked; upload.check = checkDraft(upload.draft); renderUpload(); };
    document.getElementById("discard").onclick = () => { upload.draft = null; upload.check = null; upload.notes = []; upload.names = []; renderUpload(); };
    const maybe = upload.names.filter((n) => !n.sure);
    app.querySelectorAll("[data-name-fix]").forEach((b) => b.onclick = () => {
      const n = maybe[Number(b.dataset.nameFix)];
      upload.draft.players[n.i].name = n.to;
      upload.names = upload.names.map((x) => x === n ? { ...x, sure: true } : x);
      upload.check = checkDraft(upload.draft);
      renderUpload();
    });
  }
}

// ---------- Leagues ----------
// Two data sources share the same pages: community scrims (screenshots uploaded to
// Firestore) and one AD2L division's ticketed games (data/ad2l.json, built offline by
// `npm run ad2l:sync` from PlayOn rosters + OpenDota match details).

let ad2lCache = null;
async function ad2lData() {
  if (!ad2lCache) {
    const res = await fetch("data/ad2l.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("The AD2L data hasn't been published yet.");
    const d = await res.json();
    d.games = d.games.map((g) => withDerived({ ...g, createdAt: new Date(g.start_time * 1000) }));
    ad2lCache = d;
  }
  return ad2lCache;
}

const SOURCES = {
  scrim: {
    key: "scrim", kicker: "The ledger", load: allMatches,
    link: (m) => `#/match/${m.id}`, base: "#/",
    empty: `The ledger is empty. <a href="#/upload">Upload the first scrim</a>.`,
    nav: [["#/", "matches", "Matches"], ["#/week", "week", "Weekly"], ["#/teams", "teams", "Teams"], ["#/tiers", "tiers", "Tiers"], ["#/players", "players", "Players"], ["#/heroes", "heroes", "Heroes"], ["#/upload", "upload", "Upload", "nav-cta"]],
  },
  ad2l: {
    key: "ad2l", kicker: "AD2L · S48 Champion", load: async () => (await ad2lData()).games,
    link: (m) => `#/ad2l/game/${m.id}`, base: "#/ad2l/games",
    empty: "No ticketed Champion games found yet.",
    nav: [["#/ad2l/", "standings", "Standings"], ["#/ad2l/week", "week", "Weekly"], ["#/ad2l/teams", "teams", "Teams"], ["#/ad2l/tiers", "tiers", "Tiers"], ["#/ad2l/games", "games", "Games"], ["#/ad2l/players", "players", "Players"], ["#/ad2l/heroes", "heroes", "Heroes"]],
  },
};

// ---------- Matches ----------

async function renderMatches(src) {
  const title = src.key === "ad2l" ? "Games" : "Matches";
  app.innerHTML = loading(src.kicker, title);
  let data;
  try { data = await src.load(); } catch (e) { app.innerHTML = `${pageHead(src.kicker, title)}${errorBox(e)}`; return; }
  const count = `${data.length} ${data.length === 1 ? "game" : "games"} on record${src.key === "ad2l" ? " · ticketed league games only" : ""}`;
  app.innerHTML = `
    ${pageHead(src.kicker, title, data.length ? count : "")}
    ${data.length ? `<div class="fixtures reveal">${data.map((m, i) => `
      <a class="fixture win-${m.winner}" href="${src.link(m)}" style="--i:${Math.min(i, 12)}">
        <div class="fx-team a ${m.winner === "a" ? "" : "lost"}">${teamLink(src, m.team_a, m.team_a_id, true)}${m.winner === "a" ? "<small>Victory</small>" : ""}</div>
        <div class="fx-score">
          <div class="n">${m.score_a}<i>/</i>${m.score_b}</div>
          <div class="meta">${dur(m.duration_sec)} · ${when(m.createdAt)}${m.private ? ' · <span class="priv">Private</span>' : ""}</div>
        </div>
        <div class="fx-team b ${m.winner === "b" ? "" : "lost"}">${teamLink(src, m.team_b, m.team_b_id, true)}${m.winner === "b" ? "<small>Victory</small>" : ""}</div>
      </a>`).join("")}</div>`
    : `<div class="panel empty"><strong>No games yet</strong>${src.empty}</div>`}`;
}

async function renderMatch(id, src) {
  app.innerHTML = `<div class="panel empty">Loading…</div>`;
  let raw;
  try {
    raw = (await src.load().catch(() => [])).find((m) => m.id === id) ?? (src.key === "scrim" ? await getMatch(id) : null);
  } catch (e) { app.innerHTML = errorBox(e); return; }
  if (!raw) { app.innerHTML = `<div class="notice err">No such match.</div>`; return; }
  const m = raw.teamTotals || raw.private ? raw : withDerived(raw);

  // The uploader (same browser session) can delete their own scrim; the rules check it.
  const canDelete = src.key === "scrim" && m.uid && m.uid === (await currentUid());
  const deleteBtn = canDelete ? `<div class="row" style="margin-top:18px"><button class="danger" id="del">Delete this scrim</button></div>` : "";
  const wireDelete = () => {
    const b = document.getElementById("del");
    if (!b) return;
    b.onclick = async () => {
      if (!confirm(`Delete ${m.team_a} vs ${m.team_b}? This removes it from the league for everyone and can't be undone.`)) return;
      b.disabled = true;
      b.textContent = "Deleting…";
      try {
        await deleteMatch(m.id);
        await allMatches(true);
        location.hash = "#/";
      } catch (e) {
        b.disabled = false;
        b.textContent = "Delete this scrim";
        app.insertAdjacentHTML("beforeend", `<div class="notice err">Couldn't delete: ${esc(e.message)}</div>`);
      }
    };
  };

  if (m.private) {
    const side = (t) => `<div class="plate ${t} ${m.winner === t ? "" : "lost"}">
      <div class="top-line"><span class="side">${t === "a" ? "Team A" : "Team B"}</span>${m.winner === t ? '<span class="win-badge">Victory</span>' : ""}</div>
      <div class="team">${t === "a" ? teamLink(src, m.team_a, m.team_a_id) : teamLink(src, m.team_b, m.team_b_id)}</div>
      <div class="n">${t === "a" ? m.score_a : m.score_b}</div></div>`;
    app.innerHTML = `
      <div class="kicker" style="margin-bottom:16px"><a href="${src.base}">← The ledger</a></div>
      <section class="banner">${side("a")}${side("b")}
        <div class="banner-meta">${esc(m.game_mode || "Match")} · <b>${dur(m.duration_sec)}</b></div></section>
      <div class="panel empty"><strong>Private scrim</strong>Only the result was posted. Heroes, players and stats were never uploaded.<br>
        It counts toward both teams' records; it's left out of the tier list, player and hero tables.</div>
      <p class="table-note">Posted ${when(m.createdAt)}.</p>${deleteBtn}`;
    wireDelete();
    return;
  }

  const best = (k) => Math.max(...m.players.map((p) => p[k] ?? -Infinity));
  const cols = [
    ["kills", "K"], ["deaths", "D"], ["assists", "A"], ["net_worth", "Net worth", fmt], ["last_hits", "LH"],
    ["gpm", "GPM"], ["xpm", "XPM"], ["hero_damage", "Hero dmg", fmt], ["dmg_per_min", "Dmg/min", fmt],
    ["dmg_per_1k_nw", "Dmg per 1k NW", fmt], ["dmg_share", "Dmg share", pct], ["kill_participation", "KP", pct], ["hero_healing", "Heal", fmt],
  ];
  const highlight = new Set(["kills", "net_worth", "gpm", "hero_damage", "dmg_per_min", "dmg_per_1k_nw", "kill_participation", "hero_healing"]);
  const playerCell = (p) => {
    const label = `${esc(p.name)}${p.tag ? ` <span class="tag">[${esc(p.tag)}]</span>` : ""}`;
    return playerLink(src, p, false, label);
  };
  const rows = (t) => m.players.filter((p) => p.team === t).map((p) => `
    <tr class="team-${t}">
      <td class="l">${playerCell(p)}</td>
      <td class="l">${heroLink(src, p.hero)}</td>
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
  const ad2l = src.key === "ad2l";

  const plate = (t) => {
    const won = m.winner === t;
    return `<div class="plate ${t} ${won ? "" : "lost"}">
      <div class="top-line"><span class="side">${ad2l ? (t === "a" ? "Radiant" : "Dire") : (t === "a" ? "Team A" : "Team B")}</span>${won ? '<span class="win-badge">Victory</span>' : ""}</div>
      <div class="team">${t === "a" ? teamLink(src, m.team_a, m.team_a_id) : teamLink(src, m.team_b, m.team_b_id)}</div>
      <div class="n">${t === "a" ? m.score_a : m.score_b}</div>
    </div>`;
  };
  const footer = ad2l
    ? `Played ${when(m.createdAt)} · AD2L S48 ticketed game ${m.match_id} ·
       <a href="https://www.opendota.com/matches/${m.match_id}" target="_blank" rel="noopener">OpenDota</a> ·
       <a href="https://www.dotabuff.com/matches/${m.match_id}" target="_blank" rel="noopener">Dotabuff</a>`
    : `Uploaded ${when(m.createdAt)}. Wrong? ${canDelete ? "You uploaded it, so you can delete it below." : "The uploader (from the browser they used) or the league admin can remove it."}`;

  app.innerHTML = `
    <div class="kicker" style="margin-bottom:16px"><a href="${src.base}">← ${ad2l ? "All games" : "The ledger"}</a></div>
    <section class="banner">
      ${plate("a")}${plate("b")}
      <div class="banner-meta">${esc(m.game_mode || "Match")} · <b>${dur(m.duration_sec)}</b></div>
    </section>
    ${timelineHtml(m, src)}
    <h2>Standouts</h2>
    <div class="cards reveal">${cards.map(([k, { p, v }], i) => `<div class="card" style="--i:${i}"><div class="k">${k}</div><div class="v">${v}</div><div class="s"><b>${playerLink(src, p)}</b> · ${heroLink(src, p.hero)}</div></div>`).join("")}
      <div class="card" style="--i:4"><div class="k">Team hero damage</div><div class="v pair">${fmt(ta)} <span class="muted">/</span> ${fmt(tb)}</div>
        <div class="s">${(ta > tb) === (m.winner === "a") ? "Winner out-damaged the loser" : "Loser out-damaged the winner"}</div></div>
    </div>
    <h2>Scoreboard</h2>
    <div class="table-wrap"><table>
      <thead><tr><th class="l">Player</th><th class="l">Hero</th>${cols.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead>
      <tbody>
        <tr class="sep a"><td colspan="${cols.length + 2}">${teamLink(src, m.team_a, m.team_a_id)}</td></tr>${rows("a")}
        <tr class="sep b"><td colspan="${cols.length + 2}">${teamLink(src, m.team_b, m.team_b_id)}</td></tr>${rows("b")}
      </tbody></table></div>
    <p class="table-note">▲ best in match. Dmg/min = hero damage ÷ minutes. Dmg per 1k NW = hero damage per 1,000 net worth (efficiency). KP = (kills + assists) ÷ team score.<br>${footer}</p>${deleteBtn}`;
  wireDelete();
  wireCharts(app);
}

// A game's gold story: the lead chart with each side's peak, and every player's gold.
function timelineHtml(m, src) {
  if (!hasTimeline(m)) return "";
  const s = swings(m);
  const winner = m.winner === "a" ? m.team_a : m.team_b, loser = m.winner === "a" ? m.team_b : m.team_a;
  const story = s.thrown >= BIG_LEAD
    ? `<b>${esc(loser)}</b> led by ${kg(s.thrown)} at ${s.thrown_minute}' and lost — a comeback for ${esc(winner)}.`
    : s.thrown >= 1000 ? `${esc(loser)}'s best was a ${kg(s.thrown)} lead at ${s.thrown_minute}'.` : `${esc(winner)} led wire to wire.`;
  const lines = m.players.filter((p) => Array.isArray(p.gold_t)).map((p) => ({ label: `${p.name} (${p.hero})`, values: p.gold_t, cls: `s-${p.team}` }));
  return `<h2>Gold lead</h2>
    ${leadChart(m.gold_adv, { xp: m.xp_adv, nameA: m.team_a, nameB: m.team_b, id: `lead-${m.id}` })}
    <p class="swing-story">${story} Lead changed hands ${s.lead_changes} time${s.lead_changes === 1 ? "" : "s"}${s.at10 != null ? ` · at 10': ${s.at10 >= 0 ? esc(m.team_a) : esc(m.team_b)} +${kg(Math.abs(s.at10))}` : ""}${s.at20 != null ? ` · at 20': ${s.at20 >= 0 ? esc(m.team_a) : esc(m.team_b)} +${kg(Math.abs(s.at20))}` : ""}.</p>
    ${lines.length ? `<h2>Gold by player</h2>${lineChart(lines, { caption: "Each player's gold at every minute. Hover a name to pick out their line; hover the chart for values." })}` : ""}
    <p class="table-note">${GOLD_NOTE}</p>`;
}

// ---------- AD2L standings ----------

async function renderStandings() {
  const kicker = SOURCES.ad2l.kicker;
  app.innerHTML = loading(kicker, "Standings");
  let d;
  try { d = await ad2lData(); } catch (e) { app.innerHTML = `${pageHead(kicker, "Standings")}${errorBox(e)}`; return; }

  const played = d.series.filter((s) => s.home_score != null && s.away_score != null && s.home_score + s.away_score > 0);
  const upcoming = d.series.filter((s) => !played.includes(s) && s.time && s.time * 1000 > Date.now() - 6 * 3600e3);
  const name = Object.fromEntries(d.teams.map((t) => [t.id, t.name]));
  const rows = d.teams.map((t) => {
    const mine = played.filter((s) => s.home === t.id || s.away === t.id);
    let w = 0, tie = 0, l = 0, gw = 0, gl = 0;
    for (const s of mine) {
      const [us, them] = s.home === t.id ? [s.home_score, s.away_score] : [s.away_score, s.home_score];
      gw += us; gl += them;
      if (us > them) w++; else if (us < them) l++; else tie++;
    }
    const tracked = d.games.filter((g) => g.team_a_id === t.id || g.team_b_id === t.id).length;
    return { team: t.name, id: t.id, series: mine.length, w, tie, l, gw, gl, game_rate: gw + gl ? gw / (gw + gl) : null, tracked };
  });

  const date = (s) => new Date(s * 1000).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  app.innerHTML = `
    ${pageHead(kicker, "Standings", `Series results from PlayOn; game stats from ${d.games.length} ticketed games found on OpenDota.
      Updated ${new Date(d.updated).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`)}
    <div id="t" class="reveal"></div>
    <p class="table-note">Sorted by game wins; official standings and tiebreakers live on
      <a href="https://dota.playon.gg/seasons/${d.playon_season_id}" target="_blank" rel="noopener">PlayOn</a>.
      "Stats" = games whose full stats were found (players whose match history is private can hide a game).</p>
    <h2>Strength of schedule</h2>
    <div id="sos" class="reveal"></div>
    <p class="table-note"><b>SOS</b> = (2 × opponents' game win % + their opponents' game win %) ÷ 3, the same idea as RPI.
      Opponents' records leave out their games against the team in question, so beating a team doesn't make your own
      schedule look easier. Each series counts once. <b>Still to play</b> = average game win % of the opponents left.
      Squares: every series played, oldest first (green won, red lost, grey tied); hover for details, click for the team.</p>
    ${upcoming.length ? `<h2>Up next</h2><div class="fixtures reveal">${upcoming.slice(0, 10).map((s, i) => `
      <div class="fixture" style="--i:${i}">
        <div class="fx-team a">${name[s.home] ? teamLink(SOURCES.ad2l, name[s.home], s.home) : "TBD"}</div>
        <div class="fx-score"><div class="n" style="font-size:22px">VS</div><div class="meta">${date(s.time)}</div></div>
        <div class="fx-team b">${name[s.away] ? teamLink(SOURCES.ad2l, name[s.away], s.away) : "TBD"}</div>
      </div>`).join("")}</div>` : ""}`;
  sortableTable(document.getElementById("t"), [
    ["team", "Team", (v, r) => teamLink(SOURCES.ad2l, v, r.id), "l"], ["series", "Series"], ["w", "W"], ["tie", "T"], ["l", "L"],
    ["gw", "Games won", null, "", "jade"], ["gl", "Games lost"], ["game_rate", "Game win %", pct, "", "jade"], ["tracked", "Stats"],
  ], rows, "gw");

  const sos = strengthOfSchedule(d.teams.map((t) => t.id), d.series);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const initials = (n) => { const w = n.split(/[\s-]+/).filter(Boolean); return (w.length > 1 ? w.map((x) => x[0]).join("") : n).slice(0, 3).toUpperCase(); };
  const faced = (fs) => `<span class="sos-faced">${fs.map((f) => `<a class="sos-sq ${f.result}" href="#/ad2l/teams/${f.opp}"
      title="${f.result === "w" ? "Won" : f.result === "l" ? "Lost" : "Tied"} ${f.us}–${f.them} vs ${esc(name[f.opp])} (their other games: ${pct(f.opp_rate)})">${esc(initials(name[f.opp] ?? "?"))}</a>`).join("")}</span>`;
  sortableTable(document.getElementById("sos"), [
    ["team", "Team", (v, r) => teamLink(SOURCES.ad2l, v, r.id), "l"],
    ["record", "Series W–T–L", null],
    ["sos", "SOS", pct, "", "gold"],
    ["owp", "Opp. win %", pct],
    ["oowp", "Opp. opp. win %", pct],
    ["faced", "Opponents faced", (v) => faced(v), "l"],
    ["remaining_sos", "Still to play", (v, r) => r.remaining.length ? `${pct(v)} <span class="muted">· ${r.remaining.length} left</span>` : "—", "", "ember"],
  ], sos.map((x) => ({ ...x, team: name[x.id], record: `${byId[x.id].w}–${byId[x.id].tie}–${byId[x.id].l}` })), "sos");
}

// ---------- Leaderboards ----------

// columns: [key, label, format?, class?, bar colour?]. A bar colour draws a thin bar under
// the value, scaled to the column's highest value.
// With { toolbar: true } a "Sort by" menu and direction toggle sit above the table, for
// people who don't think to click headers (and for phones, where the table scrolls).
function sortableTable(el, columns, rows, sortKey, { toolbar = false } = {}) {
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
    const bar = toolbar ? `<div class="sort-bar">
        <label>Sort by <select class="sort-key">${columns.filter(([, label]) => label).map(([k, label]) => `<option value="${k}" ${k === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <button class="sort-dir" type="button">${dir < 0 ? "High → low" : "Low → high"}</button>
        <span class="sort-hint">or click any column header ↕</span>
      </div>` : "";
    el.innerHTML = `${bar}<div class="table-wrap"><table>
      <thead><tr><th class="rank">#</th>${columns.map(([k, label, , cls]) => label ? `<th class="sortable ${cls ?? ""}${k === key ? " sorted" : ""}" data-k="${k}" title="Sort by ${label}"
        aria-sort="${k === key ? (dir < 0 ? "descending" : "ascending") : "none"}">${label}<span class="sort-ico">${k === key ? (dir < 0 ? "▾" : "▴") : "↕"}</span></th>` : "<th></th>").join("")}</tr></thead>
      <tbody>${sorted.map((r, i) => `<tr><td class="rank${i < 3 ? " top" : ""}">${String(i + 1).padStart(2, "0")}</td>${columns.map((c) => cell(c, r)).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
    el.querySelectorAll("th.sortable").forEach((th) => (th.onclick = () => {
      if (th.dataset.k === key) dir = -dir; else { key = th.dataset.k; dir = -1; }
      draw();
    }));
    if (toolbar) {
      el.querySelector(".sort-key").onchange = (e) => { key = e.target.value; dir = -1; draw(); };
      el.querySelector(".sort-dir").onclick = () => { dir = -dir; draw(); };
    }
  };
  draw();
}

async function renderPlayers(src) {
  app.innerHTML = loading(src.kicker, "Players");
  let matches;
  try { matches = (await src.load()).filter(hasDetails); } catch (e) { app.innerHTML = `${pageHead(src.kicker, "Players")}${errorBox(e)}`; return; }
  const data = playerLeaderboard(matches);
  app.innerHTML = `${pageHead(src.kicker, "Players", data.length ? `${data.length} players across ${matches.length} ${matches.length === 1 ? "game" : "games"}. Sort by any stat with the menu or by clicking a column header; click a name for that player's page.` : "")}
    ${data.length ? `<div id="t" class="reveal"></div>
    <p class="table-note">GPM, XPM, Dmg/min and Dmg per 1k NW are totals across all games, not averages of averages. ${src.key === "ad2l" ? "Players are matched by their PlayOn name (smurfs included)." : "Players are matched by name."} Bars compare against the column's best.</p>`
    : `<div class="panel empty"><strong>No players yet</strong>${src.empty}</div>`}`;
  if (!data.length) return;
  const teamCol = src.key === "ad2l"
    ? [["team", "Team", (v, r) => `${v ? teamLink(src, v) : ""}${r.standin ? ' <span class="tag">stand-in</span>' : r.standin_games ? ` <span class="tag">+${r.standin_games} as stand-in</span>` : ""}`, "l"]] : [];
  sortableTable(document.getElementById("t"), [
    ["name", "Player", (v, r) => playerLink(src, r), "l"], ...teamCol, ["games", "Games"], ["win_rate", "Win %", pct, "", "jade"],
    ["kills", "K"], ["deaths", "D"], ["assists", "A"], ["kda", "KDA", (v) => v.toFixed(2), "", "jade"],
    ["avg_gpm", "GPM", null, "", "gold"], ["avg_xpm", "XPM"], ["dmg_per_min", "Dmg/min", fmt, "", "ember"], ["dmg_per_1k_nw", "Dmg per 1k NW", fmt, "", "ember"],
    ["avg_kp", "Avg KP", pct], ["heroes", "Heroes", (v) => esc(v), "l"],
  ], data, "games", { toolbar: true });
}

// A team's gold story across its games: average lead by minute, comebacks and throws.
function teamGoldHtml(h, team, src) {
  const t = teamTimeline(h.games.map(({ m }) => m), (m) => sideOf(m, team));
  if (!t) return "";
  const rec = ({ games, wins }) => (games ? `${wins}–${games - wins}` : "—");
  const gameRef = (r, text) => (r ? `<a href="${src.link(r.m)}">${text}</a> vs ${esc(r.side === "a" ? r.m.team_b : r.m.team_a)}` : "none yet");
  const cards = [
    ["Ahead at 20'", rec(t.ahead20), `record when leading at 20 minutes`],
    ["Behind at 20'", rec(t.behind20), `record when trailing at 20 minutes`],
    ["Comebacks", String(t.comebacks), `wins after trailing by ${kg(BIG_LEAD)}+ · biggest: ${gameRef(t.best_comeback, t.best_comeback ? kg(t.best_comeback.trail) : "")}`],
    ["Throws", String(t.throws), `losses after leading by ${kg(BIG_LEAD)}+ · biggest: ${gameRef(t.worst_throw, t.worst_throw ? kg(t.worst_throw.led) : "")}`],
  ];
  return `<h2>Gold lead</h2>
    <div class="cards reveal">${cards.map(([k, v, s], i) => `<div class="card" style="--i:${i}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("")}</div>
    ${leadChart(t.curve, { nameA: team.name, nameB: "Opponents", id: `team-lead-${team.slug}` })}
    <p class="table-note">Average gold lead at each minute over ${t.games} game${t.games === 1 ? "" : "s"} with replay data. ${GOLD_NOTE}</p>`;
}

// ---------- Player page ----------

async function renderPlayer(src, key) {
  app.innerHTML = loading(src.kicker, "Player");
  let matches;
  try { matches = await src.load(); if (src.key === "ad2l") await ad2lData(); } catch (e) { app.innerHTML = `${pageHead(src.kicker, "Player")}${errorBox(e)}`; return; }
  const h = playerHistory(matches, key);
  const back = `<div class="kicker" style="margin-bottom:16px"><a href="${src.key === "ad2l" ? "#/ad2l/players" : "#/players"}">← All players</a></div>`;
  if (!h) { app.innerHTML = `${back}<div class="panel empty"><strong>No games found for this player</strong>Private scrims don't include players.</div>`; return; }
  const s = h.summary;

  // Tier-list line, if they have enough games.
  const tl = tierList(matches.filter(hasDetails));
  const tierOf = tl.tiers.flatMap(({ tier, players }) => players.map((p) => ({ ...p, tier }))).find((p) => p.key === key);
  const roster = src.key === "ad2l" ? ad2lCache.teams.flatMap((t) => t.players.map((p) => ({ ...p, team: t }))).find((p) => String(p.account_id) === key) : null;
  const rank = rankLabel(roster?.rank_tier ?? tierOf?.rank_tier);
  const sub = [
    s.team ? `${teamLink(src, s.team, roster?.team.id ?? null)}${s.standin ? " · stand-in" : ""}` : "",
    roster?.captain ? "Captain" : "",
    rank ? esc(rank) : "",
    src.key === "ad2l" ? `<a href="https://www.opendota.com/players/${encodeURIComponent(key)}" target="_blank" rel="noopener">OpenDota ↗</a>` : "",
  ].filter(Boolean).join(" · ");

  const cards = [
    ["Record", `${s.wins}–${s.games - s.wins}`, `${pct(s.win_rate)} win rate · ${s.games} game${s.games === 1 ? "" : "s"}`],
    ["KDA", s.kda.toFixed(2), `${(s.kills / s.games).toFixed(1)} / ${(s.deaths / s.games).toFixed(1)} / ${(s.assists / s.games).toFixed(1)} per game`],
    ["GPM", fmt(s.avg_gpm), `${fmt(s.avg_xpm)} XPM`],
    ["Damage / min", fmt(s.dmg_per_min), `${fmt(s.dmg_per_1k_nw)} per 1k net worth`],
    ["Kill participation", pct(s.avg_kp), "average per game"],
    tierOf ? ["Tier", `${tierOf.tier}`, `${tierOf.role === "core" ? "Core" : "Support"} · rating ${tierOf.rating}`]
      : ["Tier", "—", `needs ${MIN_GAMES}+ games`],
  ];
  const vsOf = ({ m, p }) => (p.team === "a" ? { name: m.team_b, id: m.team_b_id } : { name: m.team_a, id: m.team_a_id });
  const bestCard = (label, g, value, i) => `<a class="card hl best-game" style="--i:${i}" href="${src.link(g.m)}">${portrait(g.p.hero, "card-hero")}
    <div class="k">${label}</div><div class="v">${value}</div>
    <div class="s">${esc(g.p.hero)} · vs ${esc(vsOf(g).name)} · ${g.won ? "Won" : "Lost"}</div></a>`;

  app.innerHTML = `
    ${back}
    ${pageHead(src.kicker, esc(s.name), sub)}
    <div class="cards reveal">${cards.map(([k, v, t], i) => `<div class="card" style="--i:${i}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${t}</div></div>`).join("")}</div>
    <h2>Best games</h2>
    <div class="cards reveal">
      ${bestCard("Most damage", h.best.damage, fmt(h.best.damage.p.hero_damage), 0)}
      ${bestCard("Best KDA", h.best.kda, `${h.best.kda.p.kills}/${h.best.kda.p.deaths}/${h.best.kda.p.assists}`, 1)}
      ${bestCard("Top GPM", h.best.gpm, fmt(h.best.gpm.p.gpm), 2)}
    </div>
    ${goldCurveSection(matches, byPlayer(key), s.name)}
    <h2>Hero pool</h2>
    <div class="hero-chips">${h.heroes.map((x) => `<div class="hero-chip" title="KDA ${x.kda.toFixed(2)}">${portrait(x.hero)}<span>${heroLink(src, x.hero)}</span><b>${x.wins}–${x.games - x.wins}</b></div>`).join("")}</div>
    <h2>Every game</h2>
    <div id="t"></div>
    <p class="table-note">Newest first. Sort with the menu or any column header; the arrow opens the game.</p>`;
  wireCharts(app);

  sortableTable(document.getElementById("t"), [
    ["date", "Date", (v) => when(new Date(v)), "l"],
    ["hero", "Hero", (v) => `<span class="hero-cell">${portrait(v)}${heroLink(src, v)}</span>`, "l"],
    ["won", "Result", (v) => `<span class="res ${v ? "w" : "l"}">${v ? "Win" : "Loss"}</span>`],
    ["vs", "Opponent", (v, r) => teamLink(src, v, r.vs_id), "l"],
    ["kills", "K"], ["deaths", "D"], ["assists", "A"],
    ["net_worth", "Net worth", fmt, "", "gold"], ["gpm", "GPM"], ["xpm", "XPM"],
    ["hero_damage", "Hero dmg", fmt, "", "ember"], ["kill_participation", "KP", pct],
    ["link", "", (v) => `<a href="${v}" title="Open game">→</a>`],
  ], h.games.map((g) => ({
    date: g.m.createdAt ? +g.m.createdAt : 0, hero: g.p.hero, won: g.won ? 1 : 0, vs: vsOf(g).name, vs_id: vsOf(g).id ?? null,
    kills: g.p.kills, deaths: g.p.deaths, assists: g.p.assists, net_worth: g.p.net_worth, gpm: g.p.gpm, xpm: g.p.xpm,
    hero_damage: g.p.hero_damage, kill_participation: g.p.kill_participation ?? null, link: src.link(g.m),
  })), "date", { toolbar: true });
}

async function renderHeroes(src) {
  app.innerHTML = loading(src.kicker, "Heroes");
  let matches;
  try { matches = (await src.load()).filter(hasDetails); } catch (e) { app.innerHTML = `${pageHead(src.kicker, "Heroes")}${errorBox(e)}`; return; }
  const rows = heroStats(matches);
  app.innerHTML = `${pageHead(src.kicker, "Heroes", rows.length ? `${rows.length} heroes picked across ${matches.length} ${matches.length === 1 ? "game" : "games"}. Click a hero for who plays it and how they do; sort with the menu or any column header.` : "")}
    ${rows.length ? `<div id="t" class="reveal"></div>` : `<div class="panel empty"><strong>No picks yet</strong>${src.empty}</div>`}`;
  if (!rows.length) return;
  sortableTable(document.getElementById("t"), [
    ["hero", "Hero", (v) => `<span class="hero-cell">${portrait(v)}${heroLink(src, v)}</span>`, "l"], ["picks", "Picks", null, "", "gold"], ["pick_rate", "Pick rate", pct], ["wins", "Wins"],
    ["win_rate", "Win %", pct, "", "jade"], ["avg_damage", "Avg hero dmg", fmt, "", "ember"], ["avg_kda", "Avg KDA"],
  ], rows, "picks", { toolbar: true });
}

// ---------- Hero page ----------

async function renderHero(src, slug) {
  const hero = HEROES.find((x) => heroSlug(x) === slug);
  const back = `<div class="kicker" style="margin-bottom:16px"><a href="${src.key === "ad2l" ? "#/ad2l/heroes" : "#/heroes"}">← All heroes</a></div>`;
  if (!hero) { app.innerHTML = `${back}<div class="notice err">No such hero.</div>`; return; }
  app.innerHTML = loading(src.kicker, esc(hero));
  let matches;
  try { matches = await src.load(); } catch (e) { app.innerHTML = `${pageHead(src.kicker, esc(hero))}${errorBox(e)}`; return; }
  const h = heroHistory(matches, hero);
  const S = h.summary;
  const img = heroImg(hero);
  const head = `${back}
    <header class="page-head hero-head reveal">
      ${img ? `<img class="hero-banner" src="${img}" alt="" style="--i:0">` : ""}
      <div><div class="kicker" style="--i:0">${src.kicker}</div><h1 style="--i:1">${esc(hero)}</h1>
      <p style="--i:2">${S.picks ? `Picked ${S.picks} time${S.picks === 1 ? "" : "s"} by ${h.teams.filter((t) => t.picks).length} team${h.teams.filter((t) => t.picks).length === 1 ? "" : "s"}` : "Not picked yet"}${S.drafted ? ` · banned in ${S.bans} of ${S.drafted} drafted games` : ""}.</p></div>
    </header>`;
  if (!S.picks && !S.bans) { app.innerHTML = `${head}<div class="panel empty"><strong>No games with ${esc(hero)} yet</strong>Nobody has picked${src.key === "ad2l" ? " or banned" : ""} it in ${src.key === "ad2l" ? "this division" : "a saved scrim"}.</div>`; return; }

  const cards = [
    ["Record", S.picks ? `${S.wins}–${S.picks - S.wins}` : "—", S.picks ? `${pct(S.win_rate)} win rate` : "never picked"],
    ["Pick rate", pct(S.pick_rate), "of games with stats"],
    ...(S.drafted ? [["Ban rate", pct(S.ban_rate), `picked or banned in ${pct(S.contest_rate)} of drafts`],
      ["Draft slot", S.avg_pick_step ? `#${S.avg_pick_step.toFixed(1)}` : "—", "average pick position (of 24)"]] : []),
    ["KDA", S.kda == null ? "—" : S.kda.toFixed(2), "all players on it"],
    ["GPM", fmt(S.avg_gpm), `${fmt(S.dmg_per_min)} damage / min`],
  ];

  // Highlights: best team and player on it (wins first, then win rate, then games), biggest game, top banner.
  // One game isn't a track record: skip single-game samples when anyone has two or more.
  const rank = (xs, games) => [...xs].filter((x) => x[games] >= (xs.some((y) => y[games] >= 2) ? 2 : 1)).sort((a, b) => b.wins - a.wins || b.wins / b[games] - a.wins / a[games] || b[games] - a[games])[0];
  const topTeam = rank(h.teams, "picks");
  const topPlayer = rank(h.players, "games");
  const banner = [...h.teams].sort((a, b) => b.bans - a.bans)[0];
  const vsOf = ({ m, p }) => (p.team === "a" ? { name: m.team_b, id: m.team_b_id } : { name: m.team_a, id: m.team_a_id });
  const usOf = ({ m, p }) => (p.team === "a" ? { name: m.team_a, id: m.team_a_id } : { name: m.team_b, id: m.team_b_id });
  const hl = [
    topTeam && ["Best team on it", teamLink(src, topTeam.name, topTeam.id), `${topTeam.wins}–${topTeam.picks - topTeam.wins} · ${pct(topTeam.win_rate)} · ${topTeam.players.map(esc).join(", ")}`],
    topPlayer && ["Best player on it", playerLink(src, topPlayer), `${topPlayer.wins}–${topPlayer.games - topPlayer.wins} · KDA ${topPlayer.kda.toFixed(2)}${topPlayer.team ? ` · ${teamLink(src, topPlayer.team)}` : ""}`],
    h.best.damage && ["Biggest game", `<a href="${src.link(h.best.damage.m)}">${fmt(h.best.damage.p.hero_damage)}</a>`, `damage · ${playerLink(src, h.best.damage.p)} · ${h.best.damage.won ? "won" : "lost"} vs ${esc(vsOf(h.best.damage).name)}`],
    h.best.kda && ["Best KDA game", `<a href="${src.link(h.best.kda.m)}">${h.best.kda.p.kills}/${h.best.kda.p.deaths}/${h.best.kda.p.assists}</a>`, `${playerLink(src, h.best.kda.p)} · ${h.best.kda.won ? "won" : "lost"} vs ${esc(vsOf(h.best.kda).name)}`],
    banner?.bans && ["Bans it most", teamLink(src, banner.name, banner.id), `${banner.bans} ban${banner.bans === 1 ? "" : "s"}`],
  ].filter(Boolean);

  app.innerHTML = `${head}
    <div class="cards reveal">${cards.map(([k, v, t], i) => `<div class="card" style="--i:${i}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${t}</div></div>`).join("")}</div>
    ${hl.length ? `<h2>Highlights</h2><div class="cards reveal">${hl.map(([k, v, t], i) => `<div class="card hl" style="--i:${i}"><div class="k">${k}</div><div class="v small">${v}</div><div class="s">${t}</div></div>`).join("")}</div>` : ""}
    ${goldCurveSection(matches, byHero(hero), hero)}
    <h2>Teams</h2>
    <div id="teams"></div>
    <p class="table-note">Win % is that team's record when they picked ${esc(hero)}.${S.drafted ? " Bans come from Captains Mode drafts; “Banned vs them” = opponents banned it against that team." : ""}</p>
    ${h.players.length ? `<h2>Players</h2><div id="players"></div>` : ""}
    ${h.games.length ? `<h2>Every game</h2><div id="games"></div><p class="table-note">Newest first. The arrow opens the game.</p>` : ""}`;

  wireCharts(app);
  sortableTable(document.getElementById("teams"), [
    ["name", "Team", (v, r) => teamLink(src, v, r.id), "l"],
    ["picks", "Picks", null, "", "gold"], ["wins", "Wins"],
    ["win_rate", "Win %", (v, r) => (r.picks ? pct(v) : "—"), "", "jade"],
    ...(S.drafted ? [["bans", "Bans", null, "", "ember"], ["banned_against", "Banned vs them"]] : []),
    ["players", "Played by", (v) => v.map(esc).join(", ") || "—", "l"],
  ], h.teams, "picks", { toolbar: true });
  if (h.players.length) sortableTable(document.getElementById("players"), [
    ["name", "Player", (v, r) => playerLink(src, r), "l"],
    ["team", "Team", (v) => (v ? teamLink(src, v) : "—"), "l"],
    ["games", "Games", null, "", "gold"], ["wins", "Wins"], ["win_rate", "Win %", pct, "", "jade"],
    ["kda", "KDA", (v) => v.toFixed(2), "", "jade"], ["avg_gpm", "GPM"], ["dmg_per_min", "Dmg/min", fmt, "", "ember"], ["avg_kp", "KP", pct],
  ], h.players, "games", { toolbar: true });
  if (h.games.length) sortableTable(document.getElementById("games"), [
    ["date", "Date", (v) => when(new Date(v)), "l"],
    ["player", "Player", (v, r) => playerLink(src, r.p), "l"],
    ["us", "Team", (v, r) => teamLink(src, v, r.us_id), "l"],
    ["won", "Result", (v) => `<span class="res ${v ? "w" : "l"}">${v ? "Win" : "Loss"}</span>`],
    ["vs", "Opponent", (v, r) => teamLink(src, v, r.vs_id), "l"],
    ["kills", "K"], ["deaths", "D"], ["assists", "A"],
    ["net_worth", "Net worth", fmt, "", "gold"], ["gpm", "GPM"], ["hero_damage", "Hero dmg", fmt, "", "ember"],
    ["link", "", (v) => `<a href="${v}" title="Open game">→</a>`],
  ], h.games.map((g) => ({
    date: g.m.createdAt ? +g.m.createdAt : 0, p: g.p, player: g.p.name, us: usOf(g).name, us_id: usOf(g).id ?? null,
    won: g.won ? 1 : 0, vs: vsOf(g).name, vs_id: vsOf(g).id ?? null,
    kills: g.p.kills, deaths: g.p.deaths, assists: g.p.assists, net_worth: g.p.net_worth, gpm: g.p.gpm, hero_damage: g.p.hero_damage, link: src.link(g.m),
  })), "date");
}

// ---------- Weekly recap ----------

// Weeks run Monday 00:00 → Sunday (local time).
function weekStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const shortDate = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

// A game's MVP: the winning-side player with the best average of damage share, kill
// participation and net-worth share.
function gameMvp(m) {
  const nwTotal = (t) => m.teamTotals[t].net_worth || 1;
  const rate = (p) => ((p.dmg_share ?? 0) + (p.kill_participation ?? 0) + p.net_worth / nwTotal(p.team)) / 3;
  return m.players.filter((p) => p.team === m.winner).sort((a, b) => rate(b) - rate(a))[0];
}

function weekHighlights(games, src) {
  const all = games.flatMap((m) => m.players.map((p) => ({ p, m })));
  const best = (score) => all.reduce((top, x) => (!top || score(x) > score(top) ? x : top), null);
  const mvps = {};
  for (const m of games) {
    const p = gameMvp(m);
    const k = p.player_key ?? p.name.toLowerCase();
    (mvps[k] ??= { p, n: 0 }).n++;
  }
  const pow = Object.values(mvps).sort((a, b) => b.n - a.n)[0];
  const gamesOf = (p) => games.filter((m) => m.players.some((q) => (q.player_key ?? q.name) === (p.player_key ?? p.name))).length;
  const dmg = best(({ p }) => p.hero_damage);
  const kda = best(({ p }) => (p.kills + p.assists) / Math.max(p.deaths, 1));
  const gpm = best(({ p }) => p.gpm);
  const kills = best(({ p }) => p.kills);
  const vs = (m) => `${esc(m.team_a)} vs ${esc(m.team_b)}`;
  return [
    ["Player of the week", playerLink(src, pow.p), `${pow.n} MVP${pow.n === 1 ? "" : "s"} in ${gamesOf(pow.p)} game${gamesOf(pow.p) === 1 ? "" : "s"}`, pow.p.hero],
    ["Biggest damage game", fmt(dmg.p.hero_damage), `<b>${playerLink(src, dmg.p)}</b> · ${heroLink(src, dmg.p.hero)} · ${vs(dmg.m)}`, dmg.p.hero],
    ["Best KDA", `${kda.p.kills}/${kda.p.deaths}/${kda.p.assists}`, `<b>${playerLink(src, kda.p)}</b> · ${heroLink(src, kda.p.hero)} · ${vs(kda.m)}`, kda.p.hero],
    ["Top GPM", fmt(gpm.p.gpm), `<b>${playerLink(src, gpm.p)}</b> · ${heroLink(src, gpm.p.hero)} · ${vs(gpm.m)}`, gpm.p.hero],
    ["Most kills", fmt(kills.p.kills), `<b>${playerLink(src, kills.p)}</b> · ${heroLink(src, kills.p.hero)} · ${vs(kills.m)}`, kills.p.hero],
  ];
}

const portrait = (hero, cls = "") => {
  const src = heroImg(hero);
  return src ? `<img class="hero-img ${cls}" src="${src}" alt="${esc(hero)}" title="${esc(hero)}" loading="lazy">` : `<span class="hero-img ${cls} missing" title="${esc(hero)}">${esc(hero.slice(0, 2))}</span>`;
};

function draftStrip(m, src) {
  if (!m.draft?.length) return `<p class="draft-none">Draft order isn't on the post-game screen, so scrims show lineups only.</p>`;
  return `<div class="draft" aria-label="Draft order">${m.draft.map((s, i) => `
    <a class="draft-step ${s.pick ? "pick" : "ban"} side-${s.side}" href="${heroHref(src, s.hero)}" title="${i + 1}. ${s.side === "a" ? esc(m.team_a) : esc(m.team_b)} ${s.pick ? "picks" : "bans"} ${esc(s.hero)}">
      ${portrait(s.hero)}<span class="draft-n">${i + 1}</span>
    </a>`).join("")}</div>
    <div class="draft-legend"><span class="lg a">${esc(m.team_a)}</span><span class="lg b">${esc(m.team_b)}</span><span class="lg ban">Ban</span><span class="lg pick">Pick</span></div>`;
}

function gamePanel(m, src, label) {
  if (m.private) {
    return `<article class="game-panel">
      <header class="gp-head">
        <span class="gp-label">${label}</span>
        <span class="gp-result"><b class="${m.winner === "a" ? "w" : ""}">${teamLink(src, m.team_a, m.team_a_id)}</b> <span class="gp-score">${m.score_a}–${m.score_b}</span> <b class="${m.winner === "b" ? "w" : ""}">${teamLink(src, m.team_b, m.team_b_id)}</b></span>
        <span class="gp-meta">${dur(m.duration_sec)} · <span class="priv">Private</span> · result only</span>
      </header>
    </article>`;
  }
  const mvp = gameMvp(m);
  const lineup = (t) => m.players.filter((p) => p.team === t).map((p) => `
    <li class="${p === mvp ? "mvp" : ""}">${portrait(p.hero)}
      <span class="lu-name">${playerLink(src, p)}${p === mvp ? ' <span class="mvp-tag">MVP</span>' : ""}</span>
      <span class="lu-kda">${p.kills}/${p.deaths}/${p.assists}</span>
      <span class="lu-nw">${fmt(p.net_worth)}</span>
    </li>`).join("");
  return `<article class="game-panel">
    <header class="gp-head">
      <span class="gp-label">${label}</span>
      <span class="gp-result"><b class="${m.winner === "a" ? "w" : ""}">${teamLink(src, m.team_a, m.team_a_id)}</b> <span class="gp-score">${m.score_a}–${m.score_b}</span> <b class="${m.winner === "b" ? "w" : ""}">${teamLink(src, m.team_b, m.team_b_id)}</b></span>
      <span class="gp-meta">${dur(m.duration_sec)} · ${esc(m.winner === "a" ? m.team_a : m.team_b)} win · <a href="${src.link(m)}">Full stats →</a></span>
    </header>
    ${draftStrip(m, src)}
    <div class="lineups">
      <ul class="lineup a"><li class="lu-head">${teamLink(src, m.team_a, m.team_a_id)}${m.winner === "a" ? ' <span class="win-badge">Win</span>' : ""}</li>${lineup("a")}</ul>
      <ul class="lineup b"><li class="lu-head">${teamLink(src, m.team_b, m.team_b_id)}${m.winner === "b" ? ' <span class="win-badge">Win</span>' : ""}</li>${lineup("b")}</ul>
    </div>
  </article>`;
}

async function renderWeek(src, back = 0) {
  app.innerHTML = loading(src.kicker, "Weekly recap");
  let games, ad2l = null;
  try {
    games = await src.load();
    if (src.key === "ad2l") ad2l = await ad2lData();
  } catch (e) { app.innerHTML = `${pageHead(src.kicker, "Weekly recap")}${errorBox(e)}`; return; }
  const weeks = [...new Set(games.map((m) => weekStart(m.createdAt).getTime()))].sort((a, b) => b - a);
  if (!weeks.length) {
    app.innerHTML = `${pageHead(src.kicker, "Weekly recap")}<div class="panel empty"><strong>No games yet</strong>${src.empty}</div>`;
    return;
  }
  back = Math.min(Math.max(0, back), weeks.length - 1);
  const start = new Date(weeks[back]);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const inWeek = games.filter((m) => weekStart(m.createdAt).getTime() === weeks[back]).sort((a, b) => a.createdAt - b.createdAt);
  const base = src.key === "ad2l" ? "#/ad2l/week" : "#/week";
  const navBtn = (to, label, on) => on ? `<a class="week-btn" href="${base}/${to}">${label}</a>` : `<span class="week-btn off">${label}</span>`;
  // Every week with games, oldest first. Numbered from the first week, so a week with no
  // games shows up as a skipped number.
  const WEEK_MS = 7 * 864e5;
  const first = weeks[weeks.length - 1];
  const counts = new Map();
  for (const m of games) { const w = weekStart(m.createdAt).getTime(); counts.set(w, (counts.get(w) ?? 0) + 1); }
  const picker = `<nav class="week-pick" aria-label="Weeks">
    <div class="week-pick-label">Week</div>
    <div class="week-chips">${weeks.map((w, i) => ({ w, i })).reverse().map(({ w, i }) => {
      const n = Math.round((w - first) / WEEK_MS) + 1, c = counts.get(w);
      return `<a class="week-chip${i === back ? " on" : ""}" href="${base}/${i}" ${i === back ? 'aria-current="page"' : ""}
        title="Week of ${shortDate(new Date(w))} · ${c} game${c === 1 ? "" : "s"}">
        <span class="wn">${n}</span><span class="wd">${shortDate(new Date(w))}</span><span class="wc">${c}g</span></a>`;
    }).join("")}</div>
  </nav>`;

  let body;
  if (ad2l) {
    // Group games under their PlayOn series.
    const bySeries = new Map();
    for (const m of inWeek) (bySeries.get(m.series_id) ?? bySeries.set(m.series_id, []).get(m.series_id)).push(m);
    const tname = Object.fromEntries(ad2l.teams.map((t) => [t.id, t.name]));
    body = [...bySeries.entries()].map(([sid, gs], i) => {
      const s = ad2l.series.find((x) => x.id === sid);
      const head = s
        ? `<span>${teamLink(src, tname[s.home], s.home)}</span> <span class="series-score">${s.home_score ?? "?"}–${s.away_score ?? "?"}</span> <span>${teamLink(src, tname[s.away], s.away)}</span>`
        : `${esc(gs[0].team_a)} vs ${esc(gs[0].team_b)}`;
      return `<section class="series" style="--i:${i}">
        <h2 class="series-head">${head}</h2>
        ${gs.map((m, j) => gamePanel(m, src, `Game ${j + 1}`)).join("")}
      </section>`;
    }).join("");
  } else {
    body = `<div class="reveal">${inWeek.map((m, i) => `<div style="--i:${i}">${gamePanel(m, src, when(m.createdAt))}</div>`).join("")}</div>`;
  }

  // Highlights only from games with details (private scrims are results only).
  const detailed = inWeek.filter(hasDetails);
  const hl = detailed.length ? weekHighlights(detailed, src) : [];
  // Biggest comeback of the week (games with a gold timeline).
  const swung = detailed.filter(hasTimeline).map((m) => ({ m, s: swings(m) })).sort((a, b) => b.s.thrown - a.s.thrown)[0];
  if (swung && swung.s.thrown >= 1000) {
    const { m, s } = swung;
    const winner = m.winner === "a" ? m.team_a : m.team_b, loser = m.winner === "a" ? m.team_b : m.team_a;
    hl.push(["Biggest comeback", `<a href="${src.link(m)}">${kg(s.thrown)}</a>`,
      `${teamLink(src, winner, m.winner === "a" ? m.team_a_id : m.team_b_id)} came back after ${teamLink(src, loser, m.winner === "a" ? m.team_b_id : m.team_a_id)} led by ${kg(s.thrown)} at ${s.thrown_minute}'`, null]);
  }
  app.innerHTML = `
    <div class="week-top">
      ${pageHead(src.kicker, "Weekly recap", `Week of ${shortDate(start)} – ${shortDate(end)} · ${inWeek.length} game${inWeek.length === 1 ? "" : "s"}${src.key === "ad2l" ? " · drafts in pick/ban order" : ""}`)}
      ${picker}
    </div>
    <div class="week-nav">${navBtn(back + 1, "← Earlier week", back < weeks.length - 1)}${navBtn(back - 1, "Later week →", back > 0)}</div>
    ${hl.length ? `<h2>Highlights</h2>
    <div class="cards reveal">${hl.map(([k, v, s, hero], i) => `<div class="card hl" style="--i:${i}">${hero ? portrait(hero, "card-hero") : ""}<div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("")}</div>` : ""}
    <h2>${src.key === "ad2l" ? "Series" : "Games"}</h2>
    ${body}`;
}

// ---------- Teams ----------

async function renderTeams(src, slug) {
  app.innerHTML = loading(src.kicker, "Teams");
  let matches, ad2l = null;
  try {
    matches = await src.load();
    if (src.key === "ad2l") ad2l = await ad2lData();
  } catch (e) { app.innerHTML = `${pageHead(src.kicker, "Teams")}${errorBox(e)}`; return; }
  const base = src.key === "ad2l" ? "#/ad2l/teams" : "#/teams";
  let teams = listTeams(matches, ad2l?.teams ?? []);
  if (ad2l) {
    // AD2L records from PlayOn's series scores (official; complete even when a game's
    // stats couldn't be found).
    teams = teams.map((t) => {
      let wins = 0, losses = 0;
      for (const s of ad2l.series.filter((x) => x.home === t.id || x.away === t.id)) {
        const [us, them] = s.home === t.id ? [s.home_score, s.away_score] : [s.away_score, s.home_score];
        wins += us ?? 0; losses += them ?? 0;
      }
      return { ...t, wins, losses, games: wins + losses };
    }).sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name));
  }

  if (!slug) {
    app.innerHTML = `
      ${pageHead(src.kicker, "Teams", teams.length ? `${teams.length} teams. Pick one for its full history.` : "")}
      ${teams.length ? `<div class="team-grid reveal">${teams.map((t, i) => `
        <a class="team-card" href="${base}/${t.slug}" style="--i:${Math.min(i, 14)}">
          <span class="tc-name">${esc(t.name)}</span>
          <span class="tc-rec"><b>${t.wins}</b>–${t.losses}</span>
          <span class="tc-meta">${t.games ? `${Math.round((t.wins / t.games) * 100)}% of ${t.games} game${t.games === 1 ? "" : "s"}` : "No games yet"}</span>
        </a>`).join("")}</div>`
      : `<div class="panel empty"><strong>No teams yet</strong>${src.empty}</div>`}`;
    return;
  }

  const team = teams.find((t) => t.slug === slug);
  if (!team) { app.innerHTML = `${pageHead(src.kicker, "Teams")}<div class="notice err">No team “${esc(slug)}”. <a href="${base}">All teams</a></div>`; return; }
  const h = teamHistory(matches, team);
  const roster = ad2l?.teams.find((t) => t.id === team.id)?.players ?? null;
  const pct0 = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);

  const picker = `<label class="team-picker"><span>Team</span>
    <select id="team-select">${teams.map((t) => `<option value="${t.slug}" ${t.slug === slug ? "selected" : ""}>${esc(t.name)} (${t.wins}–${t.losses})</option>`).join("")}</select></label>`;

  // AD2L record comes from PlayOn's series scores (official, and complete even when a
  // game's stats couldn't be found); scrims use their own games.
  const rec = ad2l
    ? { w: team.wins, l: team.losses, note: team.games ? `${pct0(team.wins / team.games)} of games · from PlayOn` : "no games yet" }
    : { w: h.wins, l: h.losses, note: h.played ? `${pct0(h.win_rate)} win rate` : "no games yet" };
  const stats = [
    ["Record", `${rec.w}–${rec.l}`, rec.note],
    ["Avg game", h.avg_minutes ? `${Math.round(h.avg_minutes)} min` : "—", `${h.played} game${h.played === 1 ? "" : "s"}${ad2l ? " with stats" : ""}${h.private_games ? ` · ${h.private_games} private` : ""}`],
    ["Avg kills", h.avg_kills_for != null ? h.avg_kills_for.toFixed(1) : "—", h.avg_kills_against != null ? `${h.avg_kills_against.toFixed(1)} against` : ""],
    ["Most played", h.heroes[0] ? esc(h.heroes[0].hero) : "—", h.heroes[0] ? `${h.heroes[0].picks} games · ${h.heroes[0].wins}–${h.heroes[0].picks - h.heroes[0].wins}` : "no hero data"],
  ];

  // Series (AD2L) or game (scrim) history.
  let history;
  if (ad2l) {
    const tname = Object.fromEntries(ad2l.teams.map((t) => [t.id, t.name]));
    const mine = ad2l.series.filter((s) => s.home === team.id || s.away === team.id).sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
    history = mine.map((s, i) => {
      const home = s.home === team.id;
      const [us, them] = home ? [s.home_score, s.away_score] : [s.away_score, s.home_score];
      const played = (us ?? 0) + (them ?? 0) > 0;
      const result = !played ? "upcoming" : us > them ? "win" : us < them ? "loss" : "tie";
      const gs = h.games.filter(({ m }) => m.series_id === s.id).sort((a, b) => a.m.createdAt - b.m.createdAt);
      return `<div class="hist-row ${result}" style="--i:${Math.min(i, 12)}">
        <span class="hist-res">${result === "upcoming" ? "Next" : result === "tie" ? "T" : result === "win" ? "W" : "L"}</span>
        <span class="hist-vs">vs <b>${tname[home ? s.away : s.home] ? teamLink(src, tname[home ? s.away : s.home], home ? s.away : s.home) : "TBD"}</b></span>
        <span class="hist-score">${played ? `${us}–${them}` : ""}</span>
        <span class="hist-games">${gs.map(({ m, side }, j) => `<a href="${src.link(m)}" class="${m.winner === side ? "w" : "l"}">G${j + 1} ${m.winner === side ? "W" : "L"}</a>`).join("")}</span>
        <span class="hist-date">${s.time ? new Date(s.time * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</span>
      </div>`;
    }).join("");
  } else {
    history = h.games.map(({ m, side }, i) => {
      const won = m.winner === side;
      const opp = side === "a" ? m.team_b : m.team_a;
      const [us, them] = side === "a" ? [m.score_a, m.score_b] : [m.score_b, m.score_a];
      return `<a class="hist-row ${won ? "win" : "loss"}" href="${src.link(m)}" style="--i:${Math.min(i, 12)}">
        <span class="hist-res">${won ? "W" : "L"}</span>
        <span class="hist-vs">vs <b>${teamLink(src, opp, null, true)}</b></span>
        <span class="hist-score">${us}–${them}</span>
        <span class="hist-games">${dur(m.duration_sec)}${m.private ? ' · <span class="priv">Private</span>' : ""}</span>
        <span class="hist-date">${when(m.createdAt)}</span>
      </a>`;
    }).join("");
  }

  const heroChips = (list, count) => list.slice(0, 12).map((x) => `<div class="hero-chip">${portrait(x.hero)}<span>${heroLink(src, x.hero)}</span><b>${count(x)}</b></div>`).join("");
  const rosterHtml = roster
    ? roster.map((p) => `<li>${p.captain ? '<span class="cap" title="Captain">C</span>' : ""}${playerLink(src, { key: String(p.account_id), name: p.name })}${rankLabel(p.rank_tier) ? `<span class="tag">${esc(rankLabel(p.rank_tier))}</span>` : ""}</li>`).join("")
    : h.players.map((p) => `<li>${playerLink(src, p)}<span class="tag">${p.games} game${p.games === 1 ? "" : "s"}${p.standin ? " · stand-in" : ""}</span></li>`).join("");

  app.innerHTML = `
    <div class="kicker" style="margin-bottom:16px"><a href="${base}">← All teams</a></div>
    <header class="page-head reveal">
      <div class="kicker" style="--i:0">${src.kicker} · Team</div>
      <h1 style="--i:1">${esc(team.name)}</h1>
    </header>
    ${picker}
    <div class="cards reveal">${stats.map(([k, v, s], i) => `<div class="card" style="--i:${i}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("")}</div>
    <div class="team-cols">
      <section>
        <h2>${ad2l ? "Series" : "History"}</h2>
        <div class="history reveal">${history || `<div class="panel empty">No games yet.</div>`}</div>
      </section>
      <section>
        <h2>${roster ? "Roster" : "Players"}</h2>
        <ul class="roster">${rosterHtml || `<li class="muted">No player data${h.private_games ? " (private scrims only)" : ""}.</li>`}</ul>
      </section>
    </div>
    ${h.heroes.length ? `<h2>Hero pool</h2><div class="hero-chips">${heroChips(h.heroes, (x) => `${x.wins}–${x.picks - x.wins}`)}</div>` : ""}
    ${h.drafted ? `
      <div class="team-cols">
        <section><h2>They ban</h2><div class="hero-chips">${heroChips(h.bans, (x) => `×${x.n}`)}</div></section>
        <section><h2>Banned against them</h2><div class="hero-chips">${heroChips(h.banned_against, (x) => `×${x.n}`)}</div></section>
      </div>
      <p class="table-note">From ${h.drafted} drafted game${h.drafted === 1 ? "" : "s"}. Hero pool shows win–loss on each hero.</p>` : ""}
    ${teamGoldHtml(h, team, src)}
    ${h.detailed.length ? `<h2>Player stats for this team</h2><div id="t"></div>` : ""}`;
  wireCharts(app);

  document.getElementById("team-select").onchange = (e) => { location.hash = `${base}/${e.target.value}`; };
  if (h.detailed.length) {
    // Only this team's side of each game.
    const ownSide = h.games.filter(({ m }) => hasDetails(m)).map(({ m, side }) => ({ ...m, players: m.players.filter((p) => p.team === side) }));
    sortableTable(document.getElementById("t"), [
      ["name", "Player", (v, r) => playerLink(src, r), "l"], ["games", "Games"], ["win_rate", "Win %", pct, "", "jade"],
      ["kda", "KDA", (v) => v.toFixed(2), "", "jade"], ["avg_gpm", "GPM", null, "", "gold"], ["dmg_per_min", "Dmg/min", fmt, "", "ember"],
      ["avg_kp", "Avg KP", pct], ["heroes", "Heroes", (v) => esc(v), "l"],
    ], playerLeaderboard(ownSide.map((m) => ({ ...m, players: m.players }))), "games");
  }
}

// ---------- Tier list ----------

let tierRole = "all";
async function renderTiers(src) {
  app.innerHTML = loading(src.kicker, "Tier list");
  let matches;
  try { matches = (await src.load()).filter(hasDetails); } catch (e) { app.innerHTML = `${pageHead(src.kicker, "Tier list")}${errorBox(e)}`; return; }
  const list = tierList(matches);
  const draw = () => {
    const show = (p) => tierRole === "all" || p.role === tierRole;
    const chip = (p, i) => {
      const rank = rankLabel(p.rank_tier);
      const tip = `Rating ${p.rating} · impact vs ${p.role}s ${p.impact >= 0 ? "+" : ""}${p.impact.toFixed(2)} · adjusted win rate ${Math.round(p.win_shrunk * 100)}% · top heroes: ${p.top_heroes.join(", ")}`;
      const name = playerLink(src, p);
      return `<div class="chip ${p.role}" style="--i:${i}" title="${esc(tip)}">
        <div class="chip-top"><span class="chip-name">${name}</span><span class="chip-rating">${p.rating}</span></div>
        <div class="chip-meta">${p.team ? teamLink(src, p.team) : ""}${p.standin ? " · stand-in" : ""}</div>
        <div class="chip-foot"><span class="role-tag">${p.role === "core" ? "Core" : "Support"}</span><span>${p.wins}–${p.games - p.wins}</span>${rank ? `<span>${esc(rank)}</span>` : ""}</div>
      </div>`;
    };
    const bands = list.tiers.map(({ tier, players }) => {
      const shown = players.filter(show);
      return `<div class="tier-band t-${tier}">
        <div class="tier-letter">${tier}</div>
        <div class="tier-chips reveal">${shown.length ? shown.map(chip).join("") : `<div class="tier-empty">—</div>`}</div>
      </div>`;
    }).join("");
    const tab = (k, label) => `<button type="button" class="seg${tierRole === k ? " on" : ""}" data-role="${k}">${label}</button>`;
    document.getElementById("tiers").innerHTML = `
      <div class="row segs">${tab("all", "Everyone")}${tab("core", "Cores")}${tab("support", "Supports")}</div>
      <div class="tier-board">${bands}</div>
      ${list.unranked.length ? `<h2>Not enough games yet</h2>
        <p class="table-note">Needs ${MIN_GAMES}+ games to be ranked: ${list.unranked.map((p) => `${playerLink(src, p)} (${p.games})`).join(", ")}.</p>` : ""}`;
    document.querySelectorAll(".seg").forEach((b) => (b.onclick = () => { tierRole = b.dataset.role; draw(); }));
  };
  app.innerHTML = `
    ${pageHead(src.kicker, "Tier list", list.eligible
      ? `${list.eligible} players ranked from ${matches.length} ${src.key === "ad2l" ? "ticketed games" : "games"} this season. Hover a player for the breakdown.`
      : "")}
    ${list.eligible ? `<div id="tiers"></div>
      <details class="how">
        <summary>How it's scored</summary>
        <p><b>Role.</b> Each game, a team's top three by net worth count as cores and the other two as supports; a player's role is the one they played most. It's an approximation — positions aren't in the data.</p>
        <p><b>Impact (70%).</b> Per-minute stats compared only with same-role players. Cores: GPM, damage/min, KDA, last hits/min, XPM, kill participation. Supports: kill participation, KDA, XPM, healing, damage. Deaths count against both.</p>
        <p><b>Winning (30%).</b> Win rate pulled toward 50% as if everyone had also played ${K_PRIOR} even games, so a hot 3–0 start doesn't outrank a 6–2 season.</p>
        <p><b>Tiers</b> by rank among everyone eligible: S top 10%, A next 20%, B next 30%, C next 25%, D last 15%. Rating is the percentile (0–100). Medal badges come from PlayOn and aren't scored. Needs ${MIN_GAMES}+ games.</p>
      </details>`
    : `<div class="panel empty"><strong>Not enough games yet</strong>Players need ${MIN_GAMES}+ games to be ranked.${src.key === "scrim" ? ` <a href="#/upload">Upload more scrims</a>.` : ""}</div>`}`;
  if (list.eligible) draw();
}

// ---------- League switcher + router ----------

const leagueBtn = document.getElementById("league-btn");
const leagueMenu = document.getElementById("league-menu");
const setMenu = (open) => { leagueMenu.hidden = !open; leagueBtn.setAttribute("aria-expanded", String(open)); };
leagueBtn.onclick = (e) => { e.stopPropagation(); setMenu(leagueMenu.hidden); };
document.addEventListener("click", (e) => { if (!e.target.closest(".switcher")) setMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

function route() {
  setMenu(false);
  const h = location.hash || "#/";
  const isAd2l = h.startsWith("#/ad2l");
  const src = isAd2l ? SOURCES.ad2l : SOURCES.scrim;
  document.body.dataset.league = src.key;
  document.title = isAd2l ? "AD2L S48 Champion · Scrim League" : "Scrim League";
  document.getElementById("league-name").innerHTML = isAd2l ? "AD2L<b>S48 Champion</b>" : "Scrim<b>League</b>";
  leagueMenu.querySelectorAll("a").forEach((a) => a.classList.toggle("current", a.dataset.league === src.key));

  let section, page;
  if (isAd2l) {
    const gameId = /^#\/ad2l\/game\/(\d+)$/.exec(h)?.[1];
    if (gameId) { section = "games"; page = () => renderMatch(gameId, src); }
    else if (h.startsWith("#/ad2l/games")) { section = "games"; page = () => renderMatches(src); }
    else if (h.startsWith("#/ad2l/teams")) { section = "teams"; page = () => renderTeams(src, decodeURIComponent(h.split("/")[3] ?? "")); }
    else if (h.startsWith("#/ad2l/week")) { section = "week"; page = () => renderWeek(src, Number(h.split("/")[3] ?? 0) || 0); }
    else if (h.startsWith("#/ad2l/tiers")) { section = "tiers"; page = () => renderTiers(src); }
    else if (h.startsWith("#/ad2l/player/")) { section = "players"; page = () => renderPlayer(src, decodeURIComponent(h.slice("#/ad2l/player/".length))); }
    else if (h.startsWith("#/ad2l/players")) { section = "players"; page = () => renderPlayers(src); }
    else if (h.startsWith("#/ad2l/hero/")) { section = "heroes"; page = () => renderHero(src, h.slice("#/ad2l/hero/".length)); }
    else if (h.startsWith("#/ad2l/heroes")) { section = "heroes"; page = () => renderHeroes(src); }
    else { section = "standings"; page = renderStandings; }
  } else {
    const matchId = /^#\/match\/([0-9a-f]{32})$/.exec(h)?.[1];
    if (matchId) { section = "matches"; page = () => renderMatch(matchId, src); }
    else if (h.startsWith("#/upload")) { section = "upload"; page = renderUpload; }
    else if (h.startsWith("#/teams")) { section = "teams"; page = () => renderTeams(src, decodeURIComponent(h.split("/")[2] ?? "")); }
    else if (h.startsWith("#/week")) { section = "week"; page = () => renderWeek(src, Number(h.split("/")[2] ?? 0) || 0); }
    else if (h.startsWith("#/tiers")) { section = "tiers"; page = () => renderTiers(src); }
    else if (h.startsWith("#/player/")) { section = "players"; page = () => renderPlayer(src, decodeURIComponent(h.slice("#/player/".length))); }
    else if (h.startsWith("#/players")) { section = "players"; page = () => renderPlayers(src); }
    else if (h.startsWith("#/hero/")) { section = "heroes"; page = () => renderHero(src, h.slice("#/hero/".length)); }
    else if (h.startsWith("#/heroes")) { section = "heroes"; page = () => renderHeroes(src); }
    else { section = "matches"; page = () => renderMatches(src); }
  }
  document.getElementById("nav").innerHTML = src.nav
    .map(([href, key, label, cls]) => `<a href="${href}" data-nav="${key}" class="${cls ?? ""}${key === section ? " active" : ""}">${label}</a>`).join("");
  return page();
}

document.getElementById("hero-list").innerHTML = HEROES.map((h) => `<option value="${esc(h)}">`).join("");
// Known player names (scrims + AD2L Champion) help fix OCR misreads in the review form.
playerIndex().then((idx) => {
  const names = idx.map((e) => e.name).sort((a, b) => a.localeCompare(b));
  document.getElementById("player-list").innerHTML = names.map((n) => `<option value="${esc(n)}">`).join("");
}).catch(() => {});
app.addEventListener("input", (e) => { if (upload.draft && e.target.closest(".edit")) onDraftInput(e); });
// Team names inside a card that's itself a link: open the team, not the card.
const openNested = (e) => {
  const t = e.target.closest?.("[data-href]");
  if (!t || (e.type === "keydown" && e.key !== "Enter")) return;
  e.preventDefault(); e.stopPropagation();
  location.hash = t.dataset.href;
};
app.addEventListener("click", openNested);
app.addEventListener("keydown", openNested);
window.addEventListener("hashchange", route);
route();
