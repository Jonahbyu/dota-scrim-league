// Team histories, from the same match list the other pages use. Works for both leagues:
// scrim teams are identified by name (case-insensitive); AD2L games also carry PlayOn
// team ids (team_a_id / team_b_id), which are preferred when present.
import { hasDetails } from "./stats.js";

export const teamSlug = (name) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";

// Which side (a/b) a team played in a match, or null.
export function sideOf(m, team) {
  if (team.id != null && m.team_a_id != null) return m.team_a_id === team.id ? "a" : m.team_b_id === team.id ? "b" : null;
  const k = team.name.trim().toLowerCase();
  return m.team_a.trim().toLowerCase() === k ? "a" : m.team_b.trim().toLowerCase() === k ? "b" : null;
}

// Every team that appears in the matches (plus any given roster teams with no games yet).
export function listTeams(matches, rosterTeams = []) {
  const map = new Map();
  const add = (name, id = null) => {
    const key = id != null ? `id:${id}` : name.trim().toLowerCase();
    if (!map.has(key)) map.set(key, { key, id, name: name.trim(), slug: id != null ? String(id) : teamSlug(name) });
    return map.get(key);
  };
  for (const t of rosterTeams) add(t.name, t.id);
  for (const m of matches) { add(m.team_a, m.team_a_id ?? null); add(m.team_b, m.team_b_id ?? null); }
  return [...map.values()].map((t) => ({ ...t, ...record(matches, t) })).sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name));
}

export function record(matches, team) {
  let wins = 0, losses = 0;
  for (const m of matches) {
    const s = sideOf(m, team);
    if (!s) continue;
    m.winner === s ? wins++ : losses++;
  }
  return { wins, losses, games: wins + losses };
}

// Full history for one team: its games (newest first), plus aggregates.
export function teamHistory(matches, team) {
  const games = matches.map((m) => ({ m, side: sideOf(m, team) })).filter((x) => x.side)
    .sort((a, b) => (b.m.createdAt ?? 0) - (a.m.createdAt ?? 0));
  const rec = record(matches, team);
  const minutes = games.reduce((s, { m }) => s + m.duration_sec / 60, 0);
  const killsFor = games.reduce((s, { m, side }) => s + (side === "a" ? m.score_a : m.score_b), 0);
  const killsAgainst = games.reduce((s, { m, side }) => s + (side === "a" ? m.score_b : m.score_a), 0);

  // Hero pool and players: only games with details (private scrims are results only).
  const detailed = games.filter(({ m }) => hasDetails(m));
  const heroes = new Map(), players = new Map();
  for (const { m, side } of detailed) {
    const won = m.winner === side;
    for (const p of m.players.filter((q) => q.team === side)) {
      const h = heroes.get(p.hero) ?? { hero: p.hero, picks: 0, wins: 0 };
      h.picks++; if (won) h.wins++;
      heroes.set(p.hero, h);
      const key = p.player_key ?? p.name.trim().toLowerCase();
      const pl = players.get(key) ?? { name: p.name, games: 0, wins: 0, standin: false };
      pl.games++; if (won) pl.wins++; if (p.standin) pl.standin = true;
      players.set(key, pl);
    }
  }

  // Draft tendencies (games with a draft): what they ban, and what gets banned against them.
  const bans = new Map(), bannedAgainst = new Map();
  let drafted = 0;
  for (const { m, side } of detailed) {
    if (!m.draft?.length) continue;
    drafted++;
    for (const s of m.draft.filter((x) => !x.pick)) {
      const target = s.side === side ? bans : bannedAgainst;
      target.set(s.hero, (target.get(s.hero) ?? 0) + 1);
    }
  }
  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([hero, n]) => ({ hero, n }));

  return {
    wins: rec.wins,
    losses: rec.losses,
    played: rec.games, // count; `games` below is the list
    win_rate: rec.games ? rec.wins / rec.games : null,
    avg_minutes: games.length ? minutes / games.length : null,
    avg_kills_for: games.length ? killsFor / games.length : null,
    avg_kills_against: games.length ? killsAgainst / games.length : null,
    private_games: games.length - detailed.length,
    games,
    detailed: detailed.map((x) => x.m),
    heroes: [...heroes.values()].sort((a, b) => b.picks - a.picks || b.wins - a.wins || a.hero.localeCompare(b.hero)),
    players: [...players.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)),
    drafted,
    bans: top(bans),
    banned_against: top(bannedAgainst),
  };
}
