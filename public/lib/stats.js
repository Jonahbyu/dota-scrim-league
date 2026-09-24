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
export function playerLeaderboard(matches) {
  const rows = new Map();
  for (const m of matches) {
    for (const p of m.players) {
      const key = p.player_key ?? p.name.trim().toLowerCase();
      const r = rows.get(key) ?? { name: p.name, teams: {}, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, gold: 0, xp: 0, minutes: 0, damage: 0, net_worth: 0, kp: [], heroes: new Set() };
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
  }));
}

export function heroStats(matches) {
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
  }));
}
