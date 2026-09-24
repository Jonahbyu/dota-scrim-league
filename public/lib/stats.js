// Derived stats and leaderboards, computed from stored match documents.
// A stored match: { team_a, team_b, score_a, score_b, winner, duration_sec, game_mode, players[10] }.

// Same game uploaded twice (either team order, by either team, public or private) → same
// fingerprint. Built only from what a private (results-only) upload also shows — teams,
// duration, kill score — so the hash can't be used to guess a private game's heroes.
export function fingerprint(m) {
  const sides = [[m.team_a, m.score_a], [m.team_b, m.score_b]]
    .map(([t, s]) => `${t.trim().toLowerCase()}:${s}`).sort().join("|");
  return `${sides}#${m.duration_sec}`;
}

// Private scrims are stored as results only (no players), so everything that reads
// players skips them.
export const hasDetails = (m) => Array.isArray(m.players) && m.players.length === 10;

export async function matchId(m) {
  const bytes = new TextEncoder().encode(fingerprint(m));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function withDerived(match) {
  if (!hasDetails(match)) return { ...match, players: [], private: true };
  const minutes = match.duration_sec / 60;
  const teamTotals = {};
  for (const t of ["a", "b"]) {
    const team = match.players.filter((p) => p.team === t);
    teamTotals[t] = {
      hero_damage: team.reduce((s, p) => s + p.hero_damage, 0),
      net_worth: team.reduce((s, p) => s + p.net_worth, 0),
    };
  }
  const players = match.players.map((p) => {
    const teamScore = p.team === "a" ? match.score_a : match.score_b;
    return {
      ...p,
      dmg_per_min: Math.round(p.hero_damage / minutes),
      dmg_per_1k_nw: p.net_worth ? Math.round((p.hero_damage / p.net_worth) * 1000) : null,
      kill_participation: teamScore ? (p.kills + p.assists) / teamScore : null,
      dmg_share: teamTotals[p.team].hero_damage ? p.hero_damage / teamTotals[p.team].hero_damage : null,
    };
  });
  return { ...match, players, teamTotals };
}

// One row per player: by `player_key` when the data has one (AD2L: main account id, so
// smurfs merge and same-named players on different teams don't), else by name
// (case-insensitive, scrims). Rates use totals across games, not averages of per-game
// rates, so a short game doesn't count as much as a long one.
// One player across games: AD2L players by main account (smurfs included), scrim players by name.
export const playerKey = (p) => p.player_key ?? p.name.trim().toLowerCase();

// Map-play fields from parsed replays (AD2L). Scrim screenshots don't have them, so they're
// only averaged over games that do (`map_games`) and are null otherwise.
export const MAP_FIELDS = ["lane_kills", "neutral_kills", "ancient_kills", "camps_stacked", "obs_placed", "sen_placed", "obs_killed", "sen_killed", "roshan_kills", "tormentor_kills"];
export const hasMapStats = (p) => p.obs_placed != null;

// Totals of the map-play fields over some player-games, as per-game averages (plus the
// raw Roshan / Tormentor totals, which are small numbers people count).
export function mapSummary(playerGames) {
  const g = playerGames.filter(hasMapStats);
  if (!g.length) return null;
  const t = Object.fromEntries(MAP_FIELDS.map((f) => [f, g.reduce((s, p) => s + (p[f] ?? 0), 0)]));
  const per = (v) => v / g.length;
  const creeps = t.lane_kills + t.neutral_kills;
  return {
    map_games: g.length,
    lane_pg: per(t.lane_kills), neutral_pg: per(t.neutral_kills), ancient_pg: per(t.ancient_kills),
    neutral_share: creeps ? t.neutral_kills / creeps : null,
    stacks_pg: per(t.camps_stacked),
    obs_pg: per(t.obs_placed), sen_pg: per(t.sen_placed),
    dewards_pg: per(t.obs_killed + t.sen_killed),
    roshans: t.roshan_kills, tormentors: t.tormentor_kills,
  };
}
const NO_MAP = { map_games: 0, lane_pg: null, neutral_pg: null, ancient_pg: null, neutral_share: null, stacks_pg: null, obs_pg: null, sen_pg: null, dewards_pg: null, roshans: null, tormentors: null };

export function playerLeaderboard(matches) {
  const rows = new Map();
  for (const m of matches) {
    for (const p of m.players) {
      const key = playerKey(p);
      const r = rows.get(key) ?? { key, account_id: p.account_id ?? null, name: p.name, teams: {}, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, gold: 0, xp: 0, minutes: 0, damage: 0, net_worth: 0, kp: [], heroes: new Set(), played: [] };
      // Count roster games and stand-in games per team separately.
      if (p.team_name) {
        const t = (r.teams[p.team_name] ??= { roster: 0, standin: 0 });
        t[p.standin ? "standin" : "roster"]++;
      }
      const minutes = m.duration_sec / 60;
      const teamScore = p.team === "a" ? m.score_a : m.score_b;
      r.games++;
      if (p.team === m.winner) r.wins++;
      r.kills += p.kills; r.deaths += p.deaths; r.assists += p.assists;
      r.gold += p.gpm * minutes; r.xp += p.xpm * minutes; r.minutes += minutes;
      r.damage += p.hero_damage; r.net_worth += p.net_worth;
      if (teamScore) r.kp.push((p.kills + p.assists) / teamScore);
      r.heroes.add(p.hero);
      r.played.push(p);
      rows.set(key, r);
    }
  }
  // A player's team is the one they're rostered on; someone who only ever filled in
  // is shown with the team they played for most and marked as a stand-in.
  const teamOf = (r) => {
    const t = Object.entries(r.teams);
    if (!t.length) return { team: null, standin: false, standin_games: 0 };
    const rostered = t.filter(([, c]) => c.roster > 0).sort((a, b) => b[1].roster - a[1].roster)[0];
    const standin_games = t.reduce((s, [, c]) => s + c.standin, 0);
    if (rostered) return { team: rostered[0], standin: false, standin_games };
    return { team: t.sort((a, b) => b[1].standin - a[1].standin)[0][0], standin: true, standin_games };
  };
  return [...rows.values()].map((r) => ({
    key: r.key,
    account_id: r.account_id,
    name: r.name,
    ...teamOf(r),
    games: r.games,
    wins: r.wins,
    win_rate: r.wins / r.games,
    kills: r.kills, deaths: r.deaths, assists: r.assists,
    kda: (r.kills + r.assists) / Math.max(r.deaths, 1),
    avg_gpm: Math.round(r.gold / r.minutes),
    avg_xpm: Math.round(r.xp / r.minutes),
    dmg_per_min: Math.round(r.damage / r.minutes),
    dmg_per_1k_nw: r.net_worth ? Math.round((r.damage / r.net_worth) * 1000) : null,
    avg_kp: r.kp.length ? r.kp.reduce((s, x) => s + x, 0) / r.kp.length : null,
    heroes: [...r.heroes].sort().join(", "),
    ...(mapSummary(r.played) ?? NO_MAP),
  }));
}

// Everything about one player: their leaderboard line, every game (newest first) and the
// heroes they played. Null if they have no games with details.
export function playerHistory(matches, key) {
  const mine = matches.filter(hasDetails).flatMap((m) => {
    const p = m.players.find((q) => playerKey(q) === key);
    return p ? [{ m, p, won: p.team === m.winner }] : [];
  });
  if (!mine.length) return null;
  const summary = playerLeaderboard(mine.map(({ m, p }) => ({ ...m, players: [p] })))[0];
  const heroes = new Map();
  for (const { p, won } of mine) {
    const h = heroes.get(p.hero) ?? { hero: p.hero, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
    h.games++; if (won) h.wins++;
    h.kills += p.kills; h.deaths += p.deaths; h.assists += p.assists;
    heroes.set(p.hero, h);
  }
  const best = (f) => mine.reduce((a, b) => (f(b) > f(a) ? b : a));
  return {
    summary,
    games: [...mine].sort((a, b) => (b.m.createdAt ?? 0) - (a.m.createdAt ?? 0)),
    heroes: [...heroes.values()].map((h) => ({ ...h, win_rate: h.wins / h.games, kda: (h.kills + h.assists) / Math.max(h.deaths, 1) }))
      .sort((a, b) => b.games - a.games || b.wins - a.wins || a.hero.localeCompare(b.hero)),
    best: {
      damage: best(({ p }) => p.hero_damage),
      kda: best(({ p }) => (p.kills + p.assists) / Math.max(p.deaths, 1)),
      gpm: best(({ p }) => p.gpm),
    },
  };
}

export const heroSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Everything about one hero: who picked it (teams and players), how they did on it, every
// game it was in, and — for games with a Captains Mode draft — who banned it and when it
// was taken. Teams are keyed by id when the data has one (AD2L), else by name.
export function heroHistory(matches, hero) {
  const detailed = matches.filter(hasDetails);
  const games = [];
  for (const m of detailed) for (const p of m.players) if (p.hero === hero) games.push({ m, p, won: p.team === m.winner });
  const teams = new Map();
  const teamOf = (m, side) => {
    const id = side === "a" ? m.team_a_id : m.team_b_id, name = side === "a" ? m.team_a : m.team_b;
    const key = id != null ? `id:${id}` : name.trim().toLowerCase();
    return teams.get(key) ?? teams.set(key, { key, id: id ?? null, name, picks: 0, wins: 0, players: new Set(), bans: 0, banned_against: 0 }).get(key);
  };
  for (const { m, p, won } of games) {
    const t = teamOf(m, p.team);
    t.picks++; if (won) t.wins++;
    t.players.add(p.name);
  }

  // Drafts: bans by each team, and the pick's position in the draft (1–24).
  let drafted = 0, bans = 0, contested = 0;
  const pickSteps = [];
  for (const m of detailed) {
    if (!m.draft?.length) continue;
    drafted++;
    const steps = m.draft.filter((s) => s.hero === hero);
    if (steps.length) contested++;
    for (const s of steps) {
      if (s.pick) { pickSteps.push(s.order + 1); continue; }
      bans++;
      teamOf(m, s.side).bans++;
      teamOf(m, s.side === "a" ? "b" : "a").banned_against++;
    }
  }

  const wins = games.filter((g) => g.won).length;
  const minutes = games.reduce((s, { m }) => s + m.duration_sec / 60, 0);
  const sum = (f) => games.reduce((s, g) => s + f(g.p), 0);
  const best = (f) => (games.length ? games.reduce((a, b) => (f(b.p) > f(a.p) ? b : a)) : null);
  return {
    hero,
    summary: {
      picks: games.length,
      wins,
      win_rate: games.length ? wins / games.length : null,
      pick_rate: detailed.length ? games.length / detailed.length : null,
      kda: games.length ? (sum((p) => p.kills) + sum((p) => p.assists)) / Math.max(sum((p) => p.deaths), 1) : null,
      avg_gpm: minutes ? Math.round(games.reduce((s, { m, p }) => s + p.gpm * m.duration_sec / 60, 0) / minutes) : null,
      dmg_per_min: minutes ? Math.round(sum((p) => p.hero_damage) / minutes) : null,
      drafted, bans,
      ban_rate: drafted ? bans / drafted : null,
      contest_rate: drafted ? contested / drafted : null,
      avg_pick_step: pickSteps.length ? pickSteps.reduce((a, b) => a + b, 0) / pickSteps.length : null,
    },
    teams: [...teams.values()].map((t) => ({ ...t, players: [...t.players].sort(), win_rate: t.picks ? t.wins / t.picks : null }))
      .sort((a, b) => b.picks - a.picks || b.wins - a.wins || b.bans - a.bans || a.name.localeCompare(b.name)),
    players: playerLeaderboard(games.map(({ m, p }) => ({ ...m, players: [p] }))),
    games: [...games].sort((a, b) => (b.m.createdAt ?? 0) - (a.m.createdAt ?? 0)),
    best: {
      damage: best((p) => p.hero_damage),
      kda: best((p) => (p.kills + p.assists) / Math.max(p.deaths, 1)),
      gpm: best((p) => p.gpm),
    },
  };
}

export function heroStats(matches) {
  // Drafts (AD2L Captains Mode): bans, and contest rate = picked or banned, per drafted game.
  const drafted = matches.filter((m) => m.draft?.length);
  const bans = new Map(), contested = new Map();
  for (const m of drafted) {
    for (const s of m.draft) if (!s.pick) bans.set(s.hero, (bans.get(s.hero) ?? 0) + 1);
    for (const h of new Set(m.draft.map((s) => s.hero))) contested.set(h, (contested.get(h) ?? 0) + 1);
  }
  const rows = new Map();
  for (const m of matches) {
    for (const p of m.players) {
      const r = rows.get(p.hero) ?? { hero: p.hero, picks: 0, wins: 0, damage: 0, kda: 0 };
      r.picks++;
      if (p.team === m.winner) r.wins++;
      r.damage += p.hero_damage;
      r.kda += (p.kills + p.assists) / Math.max(p.deaths, 1);
      rows.set(p.hero, r);
    }
  }
  return [...rows.values()].map((r) => ({
    hero: r.hero,
    picks: r.picks,
    pick_rate: r.picks / matches.length,
    wins: r.wins,
    win_rate: r.wins / r.picks,
    avg_damage: Math.round(r.damage / r.picks),
    avg_kda: Math.round((r.kda / r.picks) * 100) / 100,
    bans: drafted.length ? bans.get(r.hero) ?? 0 : null,
    ban_rate: drafted.length ? (bans.get(r.hero) ?? 0) / drafted.length : null,
    contest_rate: drafted.length ? (contested.get(r.hero) ?? 0) / drafted.length : null,
  }));
}
