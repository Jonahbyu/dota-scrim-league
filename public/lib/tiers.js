// In-season player tier list, from game stats alone.
//
//   role      Each game, a team's top 3 by net worth are cores, the other 2 supports
//             (an approximation — positions aren't in the data). A player's role is
//             the one they played most.
//   impact    Per-minute stats compared with same-role players (z-scores), weighted by
//             what matters for that role. Deaths count against.
//   winning   Win rate shrunk toward 50% as if they'd also played K_PRIOR even games,
//             so a 3–0 start doesn't beat a 6–2 season (same idea as the drafter's
//             Bayesian prior, lighter: one season, not a career).
//   score     70% impact + 30% winning, both as z-scores within role; tiers by
//             percentile across everyone eligible.

export const MIN_GAMES = 3;
export const K_PRIOR = 6;
const W_IMPACT = 0.7, W_WIN = 0.3;

// metric -> weight. Negative weight = lower is better.
const WEIGHTS = {
  core: { gpm: 1, dpm: 1, kda: 1, lhm: 0.75, xpm: 0.5, kp: 0.5, dthm: -0.5 },
  support: { kp: 1.25, kda: 1, xpm: 0.5, healm: 0.5, dpm: 0.5, dthm: -0.75 },
};

export const TIERS = [
  { tier: "S", top: 0.10 },
  { tier: "A", top: 0.30 },
  { tier: "B", top: 0.60 },
  { tier: "C", top: 0.85 },
  { tier: "D", top: 1.00 },
];

const keyOf = (p) => p.player_key ?? p.name.trim().toLowerCase();

function zScores(values) {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return values.map((v) => (sd > 0 ? (v - mean) / sd : 0));
}

export function tierList(matches, { minGames = MIN_GAMES } = {}) {
  const acc = new Map();
  for (const m of matches) {
    const minutes = m.duration_sec / 60;
    for (const t of ["a", "b"]) {
      const team = m.players.filter((p) => p.team === t);
      const score = t === "a" ? m.score_a : m.score_b;
      const byNw = [...team].sort((x, y) => y.net_worth - x.net_worth);
      for (const p of team) {
        const k = keyOf(p);
        const r = acc.get(k) ?? {
          key: k, name: p.name, team: null, teams: {}, rank_tier: null, account_id: p.account_id ?? null,
          games: 0, wins: 0, core: 0, support: 0, minutes: 0,
          gold: 0, xp: 0, dmg: 0, lh: 0, heal: 0, deaths: 0, kills: 0, assists: 0, kpSum: 0, heroes: {},
        };
        r.games++;
        if (m.winner === t) r.wins++;
        byNw.indexOf(p) < 3 ? r.core++ : r.support++;
        r.minutes += minutes;
        r.gold += p.gpm * minutes; r.xp += p.xpm * minutes;
        r.dmg += p.hero_damage; r.lh += p.last_hits; r.heal += p.hero_healing;
        r.kills += p.kills; r.deaths += p.deaths; r.assists += p.assists;
        r.kpSum += score ? (p.kills + p.assists) / score : 0;
        r.heroes[p.hero] = (r.heroes[p.hero] ?? 0) + 1;
        if (p.rank_tier != null) r.rank_tier = p.rank_tier;
        if (p.team_name && !p.standin) r.teams[p.team_name] = (r.teams[p.team_name] ?? 0) + 1;
        else if (p.team_name) r.teams[p.team_name] ??= 0;
        acc.set(k, r);
      }
    }
  }

  const players = [...acc.values()].map((r) => {
    const teamEntries = Object.entries(r.teams).sort((a, b) => b[1] - a[1]);
    const role = r.core >= r.support ? "core" : "support";
    return {
      key: r.key, name: r.name, account_id: r.account_id, rank_tier: r.rank_tier,
      team: teamEntries[0]?.[0] ?? null, standin: teamEntries.length > 0 && teamEntries[0][1] === 0,
      role, games: r.games, wins: r.wins,
      metrics: {
        gpm: r.gold / r.minutes, xpm: r.xp / r.minutes, dpm: r.dmg / r.minutes, lhm: r.lh / r.minutes,
        healm: r.heal / r.minutes, dthm: r.deaths / r.minutes,
        kda: (r.kills + r.assists) / Math.max(r.deaths, 1), kp: r.kpSum / r.games,
      },
      win_shrunk: (r.wins + K_PRIOR * 0.5) / (r.games + K_PRIOR),
      top_heroes: Object.entries(r.heroes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h),
    };
  });

  const eligible = players.filter((p) => p.games >= minGames);
  // Score within each role, so supports aren't judged on farm.
  for (const role of ["core", "support"]) {
    const group = eligible.filter((p) => p.role === role);
    if (!group.length) continue;
    const weights = WEIGHTS[role];
    const impact = new Array(group.length).fill(0);
    let wsum = 0;
    for (const [metric, w] of Object.entries(weights)) {
      const z = zScores(group.map((p) => p.metrics[metric]));
      z.forEach((v, i) => { impact[i] += v * w; });
      wsum += Math.abs(w);
    }
    const impZ = zScores(impact.map((v) => v / wsum));
    const winZ = zScores(group.map((p) => p.win_shrunk));
    group.forEach((p, i) => {
      p.impact = impZ[i];
      p.score = W_IMPACT * impZ[i] + W_WIN * winZ[i];
    });
  }

  eligible.sort((a, b) => b.score - a.score);
  eligible.forEach((p, i) => {
    p.percentile = eligible.length > 1 ? 1 - i / (eligible.length - 1) : 1;
    const position = (i + 1) / eligible.length;
    p.tier = TIERS.find((t) => position <= t.top + 1e-9).tier;
    p.rating = Math.round(p.percentile * 100);
  });

  return {
    tiers: TIERS.map(({ tier }) => ({ tier, players: eligible.filter((p) => p.tier === tier) })),
    unranked: players.filter((p) => p.games < minGames).sort((a, b) => b.games - a.games),
    eligible: eligible.length,
  };
}

// OpenDota rank_tier (tens = medal, ones = stars) -> label.
const MEDALS = ["", "Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];
export function rankLabel(rt) {
  if (!rt) return null;
  const medal = MEDALS[Math.floor(rt / 10)];
  if (!medal) return null;
  const stars = rt % 10;
  return medal === "Immortal" || !stars ? medal : `${medal} ${stars}`;
}
