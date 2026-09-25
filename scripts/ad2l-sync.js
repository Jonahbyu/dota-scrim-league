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
// Usage: npm run ad2l:sync   [--season 675 --league 20077 --out ad2l.json]
//        npm run heroic:sync  (S48 Heroic/Aegis: --season 676 --out heroic.json)
//        npm run conqueror:sync  (S48 Conqueror: --season 674 --out conqueror.json)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildingsFrom } from "../public/lib/towermap.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache");
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const OUT = path.join(ROOT, "public", "data", path.basename(arg("out", "ad2l.json")));
const SEASON_ID = Number(arg("season", 675)); // PlayOn "S48 Champion League"
const LEAGUE_ID = Number(arg("league", 20077)); // Dota league "AD2L Season 48"
const UA = "dota-scrim-league/0.1 (AD2L fan stats page; contact: jonahbyu@gmail.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// OpenDota ward logs → flat [x, y, placed_sec, life_sec, killed, ...]. A ward that left before
// its full duration (observer 360s, sentry 420s) was killed; the left log names an attacker
// even on expiry, so lifetime is the test. Wards still up at game end have no left entry.
function wardLog(placed, left) {
  if (!Array.isArray(placed)) return null;
  const gone = new Map((left ?? []).map((w) => [w.ehandle, w]));
  const out = [];
  for (const w of placed) {
    const l = gone.get(w.ehandle);
    const life = l ? l.time - w.time : -1;
    const full = w.type === "obs_log" ? 360 : 420;
    out.push(Math.round(w.x), Math.round(w.y), w.time, life, l && life < full - 5 ? 1 : 0);
  }
  return out;
}

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
async function opendota(p, method = "GET") {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(Math.max(0, 1100 - (Date.now() - lastOD))); // free tier: 60/min
    lastOD = Date.now();
    odCalls++;
    const res = await fetch(`https://api.opendota.com/api${p}`, { method, headers: { "user-agent": UA } });
    if (res.status === 429) { await sleep(15000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`OpenDota ${p}: HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`OpenDota ${p}: rate limited`);
}

// Match details never change once OpenDota has parsed the replay: cache those forever.
// Before that the response has no per-minute, ward or kill-log data, so an unparsed copy
// is refetched every run (and a parse requested) instead of being frozen in the cache.
const isParsed = (d) => Array.isArray(d.radiant_gold_adv) || d.od_data?.has_parsed === true;
async function matchDetail(id) {
  const file = path.join(CACHE, "opendota", `match_${id}.json`);
  if (existsSync(file)) {
    const cached = JSON.parse(await readFile(file, "utf8"));
    if (isParsed(cached)) return cached;
  }
  const d = await opendota(`/matches/${id}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(d));
  if (!isParsed(d)) {
    console.log(`  match ${id} not parsed by OpenDota yet; requested a parse, rerun later`);
    await opendota(`/request/${id}`, "POST").catch((e) => console.log(`  parse request failed: ${e.message}`));
  }
  return d;
}

// ---------- PlayOn parsing ----------

function parseSeason(html) {
  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
  const teams = new Map();
  for (const m of html.matchAll(/href="\/teams\/(\d+)"[^>]*>([^<]+)<\/a>/g)) teams.set(Number(m[1]), decode(m[2]));
  const series = [...new Set([...html.matchAll(/href="\/matches\/(\d+)"/g)].map((m) => Number(m[1])))];
  // Seasons split into divisions have one Participants table per division, headed
  // "Division A" etc. (Champion has none). "Division Refund" holds bye placeholders, not
  // teams, so those are dropped.
  const division = new Map();
  for (const table of html.split("<table").slice(1)) {
    const div = table.match(/<th colspan=3>\s*Division\s+([^<]+?)\s*<\/th>/)?.[1];
    if (div) for (const m of table.matchAll(/href="\/teams\/(\d+)"/g)) division.set(Number(m[1]), decode(div));
  }
  for (const [id] of teams) if (division.get(id) === "Refund") teams.delete(id);
  return { title, teams, series, division };
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
  teams.push({ id, name, ...(season.division.has(id) && { division: season.division.get(id) }), players: roster });
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

// One call per rostered account (smurfs included) for every game since the season began:
// practice lobbies (lobby_type 1) are candidate league games; public and ranked games
// (0, 7) are that player's recent pubs, used for pub form and draft predictions.
const PUB_DAYS = 30;
const candidates = new Set();
const pubRows = new Map(); // main account -> rows
for (const [acct, o] of owner) {
  const rows = await opendota(`/players/${acct}/matches?date=${Math.max(days, PUB_DAYS)}`);
  for (const r of rows) {
    if (r.lobby_type === 1) candidates.add(r.match_id);
    else if ((r.lobby_type === 0 || r.lobby_type === 7) && r.start_time > Date.now() / 1000 - PUB_DAYS * 86400 && r.duration >= 600) {
      const list = pubRows.get(o.main) ?? [];
      list.push(r);
      pubRows.set(o.main, list);
    }
  }
}
console.log(`  ${candidates.size} candidate practice-lobby games; pubs for ${pubRows.size} players`);

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
    // Per-minute series from the parsed replay (null if OpenDota hasn't parsed it):
    // team A's net-worth and XP lead (negative = team B ahead).
    gold_adv: Array.isArray(d.radiant_gold_adv) ? d.radiant_gold_adv : null,
    xp_adv: Array.isArray(d.radiant_xp_adv) ? d.radiant_xp_adv : null,
    // Roshan and Tormentor kills with the minute and the side that took them
    // (OpenDota team 2 = Radiant = "a", 3 = Dire = "b"); aegis = who picked it up.
    objectives: Array.isArray(d.objectives) ? d.objectives.flatMap((o) => {
      const type = { CHAT_MESSAGE_ROSHAN_KILL: "roshan", CHAT_MESSAGE_MINIBOSS_KILL: "tormentor", CHAT_MESSAGE_AEGIS: "aegis", CHAT_MESSAGE_AEGIS_STOLEN: "aegis_stolen" }[o.type];
      if (!type) return [];
      const side = o.team === 2 ? "a" : o.team === 3 ? "b" : o.player_slot != null ? (o.player_slot < 128 ? "a" : "b") : null;
      return [{ type, minute: Math.floor(o.time / 60), time: o.time, side }];
    }) : null,
    // Towers, barracks and Ancients as they fell: owner side, which one, second, who took it.
    buildings: buildingsFrom(d.objectives, (slot) => heroes[d.players.find((p) => p.player_slot === slot)?.hero_id] ?? null),
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
      // Gold at each minute (OpenDota gold_t), for per-player and per-hero curves.
      gold_t: Array.isArray(p.gold_t) ? p.gold_t : null,
      // Map play from the parsed replay (null if unparsed). Creep kills split lane / neutral
      // / ancient as OpenDota reports them; dewards = enemy observers + sentries killed.
      lane_kills: p.lane_kills ?? null, neutral_kills: p.neutral_kills ?? null, ancient_kills: p.ancient_kills ?? null,
      camps_stacked: p.camps_stacked ?? null,
      obs_placed: p.obs_placed ?? null, sen_placed: p.sen_placed ?? null,
      obs_killed: p.observer_kills ?? null, sen_killed: p.sentry_kills ?? null,
      // From the per-unit kill counts: OpenDota's own roshan_kills field disagreed with the
      // Roshan kill events and Aegis pickups in 12 of 38 S48 games; these always agree.
      roshan_kills: p.killed ? (p.killed.npc_dota_roshan ?? 0) : null,
      tormentor_kills: p.killed ? (p.killed.npc_dota_miniboss ?? 0) : null,
      // Ward placements, flat groups of 5: x, y (OpenDota map grid, ~64-192, Radiant bottom
      // left), second placed, seconds it lived (-1 unknown), 1 if an enemy killed it.
      obs_pos: wardLog(p.obs_log, p.obs_left_log),
      sen_pos: wardLog(p.sen_log, p.sen_left_log),
    })),
  });
}
games.sort((a, b) => b.start_time - a.start_time);

const out = {
  season: season.title.replace(/\s*\|.*$/, "") || `PlayOn season ${SEASON_ID}`,
  playon_season_id: SEASON_ID,
  league_id: LEAGUE_ID,
  updated: new Date().toISOString(),
  teams: teams.map((t) => ({ id: t.id, name: t.name, ...(t.division && { division: t.division }), players: t.players.map((p) => ({ name: p.name, captain: p.captain, account_id: p.account_ids[0], rank_tier: p.rank_tier })) })),
  series,
  games,
  // Recent pubs per player (main account; smurf games merged), last PUB_DAYS days, newest
  // first, flat groups of 7: start time, hero, won (1/0), kills, deaths, assists, ranked (1/0).
  pubs_days: PUB_DAYS,
  pubs: Object.fromEntries([...pubRows].map(([acct, rows]) => [acct, rows.sort((a, b) => b.start_time - a.start_time).flatMap((r) => [
    r.start_time, heroes[r.hero_id] ?? `hero ${r.hero_id}`, (r.player_slot < 128) === r.radiant_win ? 1 : 0, r.kills, r.deaths, r.assists, r.lobby_type === 7 ? 1 : 0,
  ])])),
};
await mkdir(path.dirname(OUT), { recursive: true });
// Pretty-printed, but arrays of numbers (the per-minute series) stay on one line.
const json = JSON.stringify(out, null, 1).replace(/\[\s*(-?\d+(?:\s*,\s*-?\d+)*)\s*\]/g, (_, xs) => `[${xs.replace(/\s+/g, "")}]`);
await writeFile(OUT, json + "\n");
console.log(`  ${games.length} division games from league ${LEAGUE_ID}; ${odCalls} OpenDota calls this run`);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
