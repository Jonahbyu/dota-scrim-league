// Build public/data/ad2l.json: one AD2L season + division (default S48 Champion) with
// teams, series results from PlayOn, and every ticketed game's stats from OpenDota.
//
// Sources (all public, no keys):
//   dota.playon.gg/seasons/{id}   -> the division's teams and PlayOn match (series) links
//   dota.playon.gg/matches/{id}   -> series time, home/away team, series score
//   dota.playon.gg/teams/{id}     -> roster: player name + 32-bit account id + smurfs
//   OpenDota /players/{id}/matches?lobby_type=1  -> candidate practice-lobby games
//   OpenDota /matches/{id}        -> full stats; `leagueid` says if it's this AD2L season
// OpenDota has no per-league match list for amateur leagues (league 20077 returns 0), and
// its league filter on player matches doesn't work, so games are found through the
// rosters. A game counts if it's tagged with the league AND both sides are rosters from
// this division (3+ of 5 players), which also drops cross-division games.
//
// Usage: npm run ad2l:sync   [--season 675 --league 20077]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache");
const OUT = path.join(ROOT, "public", "data", "ad2l.json");
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const SEASON_ID = Number(arg("season", 675)); // PlayOn "S48 Champion League"
const LEAGUE_ID = Number(arg("league", 20077)); // Dota league "AD2L Season 48"
const UA = "dota-scrim-league/0.1 (AD2L fan stats page; contact: jonahbyu@gmail.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();

// ---------- polite fetchers with on-disk caches ----------

let lastPlayOn = 0;
async function playon(p, ttlHours) {
  const file = path.join(CACHE, "playon", p.replace(/\W+/g, "_") + ".html");
  if (existsSync(file) && ttlHours > 0) {
    const { mtimeMs } = await import("node:fs").then((fs) => fs.statSync(file));
    if (Date.now() - mtimeMs < ttlHours * 3600e3) return readFile(file, "utf8");
  }
  await sleep(Math.max(0, 1200 - (Date.now() - lastPlayOn)));
  lastPlayOn = Date.now();
  const res = await fetch(`https://dota.playon.gg${p}`, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`PlayOn ${p}: HTTP ${res.status}`);
  const html = await res.text();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
  return html;
}

let lastOD = 0, odCalls = 0;
async function opendota(p) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(Math.max(0, 1100 - (Date.now() - lastOD))); // free tier: 60/min
    lastOD = Date.now();
    odCalls++;
    const res = await fetch(`https://api.opendota.com/api${p}`, { headers: { "user-agent": UA } });
    if (res.status === 429) { await sleep(15000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`OpenDota ${p}: HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`OpenDota ${p}: rate limited`);
}

// Match details never change once a game is over: cache forever.
async function matchDetail(id) {
  const file = path.join(CACHE, "opendota", `match_${id}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  const d = await opendota(`/matches/${id}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(d));
  return d;
}

// ---------- PlayOn parsing ----------

function parseSeason(html) {
  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
  const teams = new Map();
  for (const m of html.matchAll(/href="\/teams\/(\d+)"[^>]*>([^<]+)<\/a>/g)) teams.set(Number(m[1]), decode(m[2]));
  const series = [...new Set([...html.matchAll(/href="\/matches\/(\d+)"/g)].map((m) => Number(m[1])))];
  return { title, teams, series };
}

function parseSeries(html, id) {
  const epoch = Number(html.match(/data-epoch-offset='(\d+)'/)?.[1] ?? 0);
  const res = html.slice(html.indexOf("<h4>Results:</h4>"));
  const [home, away] = [...res.matchAll(/<h3><a href="\/teams\/(\d+)">([^<]*)<\/a><\/h3>/g)].slice(0, 2).map((m) => Number(m[1]));
  const scores = [...res.matchAll(/<h4>\s*(\d*)\s*<\/h4>/g)].slice(0, 2).map((m) => (m[1] === "" ? null : Number(m[1])));
  return { id, time: epoch || null, home, away, home_score: scores[0] ?? null, away_score: scores[1] ?? null };
}

// Same rules as the drafter's ad2l.py: split on the MAIN roster <li>; nested
// "-alt" entries are that player's smurfs, merged in, not extra people.
function parseRoster(html) {
  const players = [];
  for (const block of html.split('<li class="rosterNameContainer">').slice(1)) {
    const altAt = block.indexOf('<li class="rosterNameContainer rosterNameContainer-alt">');
    const main = altAt >= 0 ? block.slice(0, altAt) : block;
    const acct = main.match(/dotabuff\.com\/players\/(\d+)/);
    if (!acct) continue;
    const name = decode(main.match(/\/players\/\d+"[^>]*>([^<]+)<\/a>/)?.[1] ?? `account ${acct[1]}`);
    const alts = altAt >= 0 ? [...block.slice(altAt).matchAll(/dotabuff\.com\/players\/(\d+)/g)].map((m) => Number(m[1])) : [];
    const rank = main.match(/data-rank="(\d+)"/); // same 0-80 scale as OpenDota rank_tier
    players.push({ name, account_ids: [Number(acct[1]), ...new Set(alts)], captain: main.includes("(Captain)"), rank_tier: rank ? Number(rank[1]) : null });
  }
  return players;
}

// ---------- build ----------

console.log(`PlayOn season ${SEASON_ID}, Dota league ${LEAGUE_ID}`);
const season = parseSeason(await playon(`/seasons/${SEASON_ID}`, 6));
console.log(`  ${season.title}: ${season.teams.size} teams, ${season.series.length} series`);

const teams = [];
for (const [id, name] of season.teams) {
  const roster = parseRoster(await playon(`/teams/${id}`, 72));
  teams.push({ id, name, players: roster });
}
const owner = new Map(); // account id -> { team, player name }
// `main` is the player's main account: smurf games count for the same person.
for (const t of teams) for (const p of t.players) for (const a of p.account_ids) owner.set(a, { team: t.id, name: p.name, main: p.account_ids[0], rank_tier: p.rank_tier });
console.log(`  rosters: ${teams.reduce((s, t) => s + t.players.length, 0)} players, ${owner.size} accounts incl. smurfs`);

const series = [];
for (const id of season.series) {
  // Played series don't change; unplayed ones are re-checked.
  const s = parseSeries(await playon(`/matches/${id}`, 6), id);
  series.push(s);
}
series.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
const firstSeries = series.find((s) => s.time)?.time ?? Math.floor(Date.now() / 1000) - 90 * 86400;
const days = Math.ceil((Date.now() / 1000 - firstSeries) / 86400) + 10;
console.log(`  series: ${series.filter((s) => (s.home_score ?? 0) + (s.away_score ?? 0) > 0).length} played of ${series.length}; searching the last ${days} days`);

// Candidate games: every rostered account's practice-lobby games since the season began.
const candidates = new Set();
for (const acct of owner.keys()) {
  const rows = await opendota(`/players/${acct}/matches?lobby_type=1&date=${days}`);
  for (const r of rows) candidates.add(r.match_id);
}
console.log(`  ${candidates.size} candidate practice-lobby games`);

const heroes = Object.fromEntries((await opendota("/heroes")).map((h) => [h.id, h.localized_name === "Ring Master" ? "Ringmaster" : h.localized_name]));

const games = [];
for (const id of [...candidates].sort()) {
  const d = await matchDetail(id);
  if (d.leagueid !== LEAGUE_ID || !Array.isArray(d.players) || d.players.length !== 10) continue;
  // Which division team is each side? Majority of its 5 accounts.
  const sideTeam = (radiant) => {
    const counts = {};
    for (const p of d.players.filter((p) => p.isRadiant === radiant)) {
      const o = owner.get(p.account_id);
      if (o) counts[o.team] = (counts[o.team] ?? 0) + 1;
    }
    const [team, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [];
    return n >= 3 ? Number(team) : null;
  };
  const rad = sideTeam(true), dire = sideTeam(false);
  if (rad == null || dire == null || rad === dire) continue;
  const teamName = (id) => teams.find((t) => t.id === id).name;
  // Which PlayOn series this game belongs to: same two teams, closest scheduled time.
  const seriesOf = series
    .filter((s) => (s.home === rad && s.away === dire) || (s.home === dire && s.away === rad))
    .sort((x, y) => Math.abs((x.time ?? 0) - d.start_time) - Math.abs((y.time ?? 0) - d.start_time))[0];
  games.push({
    series_id: seriesOf?.id ?? null,
    // Captains Mode draft in order; OpenDota team 0 = Radiant = side "a".
    draft: (d.picks_bans ?? []).sort((x, y) => x.order - y.order)
      .map((pb) => ({ order: pb.order, pick: pb.is_pick, side: pb.team === 0 ? "a" : "b", hero: heroes[pb.hero_id] ?? `hero ${pb.hero_id}` })),
    id: String(d.match_id),
    match_id: d.match_id,
    start_time: d.start_time,
    team_a: teamName(rad), team_b: teamName(dire),
    team_a_id: rad, team_b_id: dire,
    score_a: d.radiant_score, score_b: d.dire_score,
    winner: d.radiant_win ? "a" : "b",
    duration_sec: d.duration,
    game_mode: "Captains Mode",
    players: [...d.players].sort((x, y) => x.player_slot - y.player_slot).map((p) => ({
      team: p.isRadiant ? "a" : "b",
      name: owner.get(p.account_id)?.name ?? p.personaname ?? (p.account_id ? `account ${p.account_id}` : "anonymous"),
      account_id: p.account_id ?? null,
      // Identity for leaderboards: names collide across teams (two "Icarus" in S48 Champion).
      player_key: String(owner.get(p.account_id)?.main ?? p.account_id ?? `${d.match_id}-${p.player_slot}`),
      team_name: teamName(p.isRadiant ? rad : dire),
      standin: owner.get(p.account_id)?.team !== (p.isRadiant ? rad : dire),
      rank_tier: owner.get(p.account_id)?.rank_tier ?? p.rank_tier ?? null,
      tag: null,
      hero: heroes[p.hero_id] ?? `hero ${p.hero_id}`,
      level: p.level, kills: p.kills, deaths: p.deaths, assists: p.assists,
      net_worth: p.net_worth ?? p.total_gold ?? 0, last_hits: p.last_hits, denies: p.denies,
      gpm: p.gold_per_min, xpm: p.xp_per_min, hero_damage: p.hero_damage ?? 0, hero_healing: p.hero_healing ?? 0,
    })),
  });
}
games.sort((a, b) => b.start_time - a.start_time);

const out = {
  season: season.title.replace(/\s*\|.*$/, "") || `PlayOn season ${SEASON_ID}`,
  playon_season_id: SEASON_ID,
  league_id: LEAGUE_ID,
  updated: new Date().toISOString(),
  teams: teams.map((t) => ({ id: t.id, name: t.name, players: t.players.map((p) => ({ name: p.name, captain: p.captain, account_id: p.account_ids[0], rank_tier: p.rank_tier })) })),
  series,
  games,
};
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`  ${games.length} division games from league ${LEAGUE_ID}; ${odCalls} OpenDota calls this run`);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
