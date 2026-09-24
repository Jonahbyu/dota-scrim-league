// Derived stats and leaderboards, computed from stored match documents.
// A stored match: { team_a, team_b, score_a, score_b, winner, duration_sec, game_mode, players[10] }.

// Same game uploaded twice (either team order, by either team) → same fingerprint.
export function fingerprint(m) {
  const heroes = m.players.map((p) => p.hero).sort().join(",");
  const teams = [m.team_a, m.team_b].map((t) => t.trim().toLowerCase()).sort().join("|");
  return `${teams}#${m.duration_sec}#${heroes}`;
}

export async function matchId(m) {
  const bytes = new TextEncoder().encode(fingerprint(m));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function withDerived(match) {
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

// One row per player name (case-insensitive). Rates use totals across games, not
// averages of per-game rates, so a short game doesn't count as much as a long one.
export function playerLeaderboard(matches) {
  const rows = new Map();
  for (const m of matches) {
    for (const p of m.players) {
      const key = p.name.trim().toLowerCase();
      const r = rows.get(key) ?? { name: p.name, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, gold: 0, xp: 0, minutes: 0, damage: 0, net_worth: 0, kp: [], heroes: new Set() };
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
  return [...rows.values()].map((r) => ({
    name: r.name,
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
