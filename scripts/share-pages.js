// Write a link-preview page for every shareable route (see public/lib/share.js) into a
// built copy of public/: /heroic/week/index.html etc. Each has that page's own title,
// description and colour for Discord and other link previews, then forwards to the #/
// route. AD2L descriptions are built from the synced data, so they're as fresh as the
// last sync. Scrim games live in Firestore, so scrim pages get fixed descriptions.
// Usage: node scripts/share-pages.js <site dir>   (the deploy runs it on a copy of public/)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { routeOf, sharePath } from "../public/lib/share.js";

const OUT = path.resolve(process.argv[2] ?? "_site");
const SITE = "https://dota2scrimcircuittracker.github.io";
const COLOR = { scrim: "#5fd39b", ad2l: "#e8b64c", heroic: "#a58bff", conqueror: "#5aa9e6" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TZ = "America/Los_Angeles";
const day = (sec) => new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
const plural = (n, w) => `${n} ${n === 1 ? w : w === "hero" ? "heroes" : w === "series" ? w : `${w}s`}`;

const pages = [];
const page = (p, title, description, color) => {
  if (sharePath(`#/${p}`) !== (p ? `/${p}/` : "/")) throw new Error(`${p} isn't a shareable route in lib/share.js`);
  pages.push({ p, title, description, color });
};

// ---------- Scrim League ----------
const scrim = (tab, title, d) => page(tab, `${title} · Scrim League`, d, COLOR.scrim);
scrim("week", "Weekly recap", "This week's scrims: every game, drafts in pick/ban order, player of the week and the standout games.");
scrim("teams", "Teams", "Every scrim team: record, roster, series history and the heroes they play.");
scrim("players", "Players", "Scrim leaderboards and the tier list: KDA, GPM, damage, win rate and more.");
scrim("heroes", "Heroes", "Every hero picked in scrims: pick and ban rates, win rates and who plays them.");
scrim("predict", "Predictions", "Pick the winners of upcoming scrims and see how the model's picks have done.");
scrim("upload", "Upload a scrim", "Paste Dota 2 post-game screenshots and the stats are read for you.");

// ---------- AD2L ----------
function standings(d) {
  const played = d.series.filter((s) => (s.home_score ?? 0) + (s.away_score ?? 0) > 0);
  return d.teams.map((t) => {
    let gw = 0, gl = 0, w = 0, tie = 0, l = 0;
    for (const s of played) {
      if (s.home !== t.id && s.away !== t.id) continue;
      const [us, them] = s.home === t.id ? [s.home_score, s.away_score] : [s.away_score, s.home_score];
      gw += us; gl += them;
      if (us > them) w++; else if (us < them) l++; else tie++;
    }
    return { t, gw, gl, w, tie, l };
  }).sort((a, b) => b.gw - a.gw || a.gl - b.gl);
}
function inDivision(d, div) {
  const ids = new Set(d.teams.filter((t) => t.division === div).map((t) => t.id));
  return { ...d, teams: d.teams.filter((t) => ids.has(t.id)), series: d.series.filter((s) => ids.has(s.home) && ids.has(s.away)), games: d.games.filter((g) => ids.has(g.team_a_id) && ids.has(g.team_b_id)) };
}

function league(root, key, name, d, view) {
  const label = view ? `${name} · ${view}` : name;
  const color = COLOR[key];
  const top = standings(d).slice(0, 3).map((r, i) => `${i + 1}. ${r.t.name} (${r.gw}–${r.gl})`).join(" · ");
  const games = d.games.length;
  page(root, `Standings · ${label}`, `${top}. Series results from PlayOn, stats from ${plural(games, "ticketed game")}.`, color);

  // Latest week: games in the 7 days up to the newest one.
  const newest = Math.max(0, ...d.games.map((g) => g.start_time));
  const recent = d.games.filter((g) => g.start_time > newest - 7 * 86400);
  page(`${root}/week`, `Weekly recap · ${label}`, recent.length
    ? `${plural(recent.length, "game")} through ${day(newest)}: drafts in pick/ban order, player of the week and the standout games.`
    : "Every week's games, drafts and highlights.", color);

  const players = new Set(d.games.flatMap((g) => g.players.map((p) => p.player_key)));
  page(`${root}/players`, `Players · ${label}`, `Leaderboards and tier list for ${plural(players.size, "player")}: KDA, GPM, damage, win rate, pubs.`, color);

  const picks = new Map();
  for (const g of d.games) for (const p of g.players) picks.set(p.hero, (picks.get(p.hero) ?? 0) + 1);
  const most = [...picks].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h, n]) => `${h} (${n})`).join(", ");
  page(`${root}/heroes`, `Heroes · ${label}`, `${plural(picks.size, "hero")} played${most ? `. Most picked: ${most}` : ""}. Pick, ban and win rates.`, color);

  const upcoming = d.series.filter((s) => !((s.home_score ?? 0) + (s.away_score ?? 0)) && s.time && s.time * 1000 > Date.now() - 6 * 3600e3).length;
  page(`${root}/predict`, `Predictions · ${label}`, `${upcoming ? `${plural(upcoming, "series")} to call. ` : ""}Pick the winners and see how the model's picks have done.`, color);
  page(`${root}/upload`, `Upload a game · ${label}`, "Played without a league ticket? Upload the post-game screenshots so the game counts in the stats.", color);

  if (view) return;
  const table = standings(d);
  for (const t of d.teams) {
    const r = table.find((x) => x.t.id === t.id);
    const place = table.indexOf(r) + 1;
    const div = t.division ? ` · Division ${t.division}` : "";
    page(`${root}/teams/${t.id}`, `${t.name} · ${name}${div}`,
      `#${place} · series ${r.w}–${r.tie}–${r.l} · games ${r.gw}–${r.gl}. Roster: ${t.players.map((p) => p.name).join(", ")}.`, color);
  }
  for (const g of d.games) {
    const won = g.winner === "a" ? g.team_a : g.team_b;
    page(`${root}/game/${g.match_id}`, `${g.team_a} ${g.score_a}–${g.score_b} ${g.team_b}`,
      `${won} won · ${Math.round(g.duration_sec / 60)} min · ${day(g.start_time)} · ${name}. Draft, scoreboard, gold graph and ward map.`, color);
  }
}

const load = async (f) => JSON.parse(await readFile(path.join(OUT, "data", f), "utf8"));
const champ = await load("ad2l.json");
league("ad2l", "ad2l", "AD2L S48 Champion", champ);
const heroic = await load("heroic.json");
league("heroic", "heroic", "AD2L S48 Heroic/Aegis", heroic, null);
for (const div of ["A", "B"]) league(`heroic/${div.toLowerCase()}`, "heroic", "AD2L S48 Heroic/Aegis", inDivision(heroic, div), `Division ${div}`);
league("conqueror", "conqueror", "AD2L S48 Conqueror", await load("conqueror.json"));

// ---------- write ----------
for (const { p, title, description, color } of pages) {
  const route = routeOf(p);
  const url = `${SITE}/${p}/`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:site_name" content="Scrim League">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="${color}">
<link rel="canonical" href="${url}">
<meta http-equiv="refresh" content="0; url=/${esc(route)}">
<script>location.replace("/" + ${JSON.stringify(route)});</script>
</head>
<body><a href="/${esc(route)}">${esc(title)}</a></body>
</html>
`;
  await mkdir(path.join(OUT, p), { recursive: true });
  await writeFile(path.join(OUT, p, "index.html"), html);
}
console.log(`wrote ${pages.length} preview pages into ${path.relative(process.cwd(), OUT) || "."}`);
