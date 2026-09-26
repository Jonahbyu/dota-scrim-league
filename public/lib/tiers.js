// In-season player tier list, from game stats alone.
//
//   score = stat points × survival × consistency × opponent strength × winning
//
//   role      Position 1–5 from the parsed replay (OpenDota's estimate); 1–3 are cores,
//             4–5 supports. Games without one (screenshot uploads, scrims) fall back to net
//             worth rank within the team. Each game is scored in the role played in it; a
//             player's listed role is the one they played most.
//   stat z    Each game, every stat is a z-score against the same position (a pos 3 is compared
//             with pos 3s), capped at ±Z_CAP, flipped for stats where less is better. GPM and
//             net worth are compared with what that position gets in a game that long (a
//             straight-line fit on game length), since both climb as games go on.
//   stat 0–100  A player's average z for each stat in a role, padded with K_SHRINK games at the
//             position average (so 3 lucky games don't read as a season). Then each stat is put on
//             its own 0–100 per role: 100 = the best such average of any player with MIN_GAMES+
//             games in that role, 0 = the worst. Capped to 0–100.
//   stat points  Each stat is worth a fixed number of points (WEIGHTS, 100 per role) and earns
//             its 0–100 as a percentage of them. No base or offset.
//   survival  Deaths, time dead and hero damage taken per life, each on its own 0–100 the same
//             way, weighted (SURVIVAL) into one 0–100 -> × 0.85 to × 1.00 on the stat points.
//   consistency  The spread (sd) of a player's series stat points, pulled toward the pool's
//             typical spread by K_CONSISTENCY series; the steadiest player sets 100, the
//             streakiest 0 -> × 0.90 to × 1.00.
//   opponents Each game's opponent: their game win % outside games against this player's team,
//             shrunk toward 50% by K_PRIOR even games. 25% -> × 0.90, 50% -> × 1.00,
//             75% -> × 1.10. Each series takes its games' average, and the season multiplier
//             weights series by their stat points, so the per-series scores average to the score.
//   winning   Win rate shrunk toward 50% by K_PRIOR even games, 25% -> 0, 75% -> 100; win speed:
//             each win scores the share of the pool's wins that took longer, shrunk toward 50
//             by K_SPEED wins. Two parts win rate to one part speed -> × 0.70 to × 1.30.
//   rating    The score through a normal curve fitted to the pool: the median player rates 50,
//             and the spread is RATING_STRETCH × the pool's standard deviation. Tiers by fixed
//             rating cutoffs.
//
// Farm, damage, building damage, XP, kills and assists are shares of the team's total, which
// don't grow with game length the way per-minute numbers do.
//
// The reference (per-position means, anchors, win lengths, consistency spread, curve) comes
// from the league itself: each AD2L division, or the scrim ledger, is scored against its own
// games (tierModel on them; the Heroic A/B views pass the whole division's model). Ratings
// compare players within a league, not across leagues.

export const MIN_GAMES = 3;
export const K_PRIOR = 6;
export const K_SPEED = 3;
export const K_CONSISTENCY = 2;
export const K_SHRINK = 3;
const Z_CAP = 2.5;
export const RATING_STRETCH = 1.5;

// Multiplier ranges: [at 0, at 100] (opponents: [at 25%, at 75%] opponent win rate).
export const MULT = {
  survival: [0.85, 1.0],
  consistency: [0.9, 1.0],
  opponents: [0.9, 1.1],
  winning: [0.7, 1.3],
};
const WIN_PARTS = { win: 2, speed: 1 }; // winning = (2 × win rate + 1 × win speed) / 3

// metric -> the points it's worth, out of 100 stat points per role. Negative = lower is
// better. A player missing a stat (screenshot uploads have no wards) has the rest scaled up
// to fill its points. See METRICS for definitions.
export const WEIGHTS = {
  core: { dmg: 15, farm: 15, kills: 13, gpm: 13, nw: 10, xp: 8, assists: 8, tower: 5, lanewin: 5, lane: 4, stuns: 4 },
  support: { dewards: 15, assists: 13, vision: 13, stuns: 8, stacks: 8, kills: 8, lanewin: 7, heal: 5, dmg: 4, sentries: 4, dust: 3, smokes: 3, gpm: 3, farm: 2, nw: 2, tower: 2 },
};
// Survival: its three parts' share of the survival score. Negative = lower is better.
export const SURVIVAL = { deaths: -40, dead: -35, tanked: 25 };

// metric -> short label and definition (the info bubbles and "How it's scored" use these).
export const METRICS = {
  farm: { label: "Farm share", def: "Share of the team's gold: the player's GPM over the team's total GPM. A share, so long games don't inflate it." },
  gpm: { label: "GPM", def: "Gold per minute, compared with what the same position gets in a game that long (GPM climbs as games go on)." },
  nw: { label: "Net worth", def: "Net worth at the end of the game, compared with what the same position has in a game that long, so a long game doesn't inflate it." },
  dmg: { label: "Damage share", def: "Share of the team's hero damage." },
  tower: { label: "Building share", def: "Share of the team's damage to towers, barracks and the Ancient." },
  xp: { label: "XP share", def: "Share of the team's experience: the player's XPM over the team's total." },
  kills: { label: "Kill share", def: "Share of the team's kills the player got the last hit on." },
  assists: { label: "Assist share", def: "Share of the team's kills the player assisted. Kill share + assist share = kill participation." },
  lanewin: { label: "Lane result", def: "Gold + XP lead at 10 minutes over the lane opponent. Cores: against the enemy core in their lane (pos 1 vs pos 3, mid vs mid). Supports: their lane pair against the enemy pair." },
  lane: { label: "Laning", def: "Laning efficiency: gold earned in the first 10 minutes as a % of the most a lane can give (OpenDota's lane efficiency)." },
  stuns: { label: "Stun time", def: "Seconds of disable dealt to enemy heroes per minute (OpenDota's stun figure)." },
  vision: { label: "Ward uptime", def: "Observer wards the player had up at once, on average: every ward's lifetime (up to its 6 minutes) added up, over the game's length." },
  dewards: { label: "Dewards", def: "Enemy wards killed per 10 minutes; a sentry counts half an observer." },
  sentries: { label: "Sentries", def: "Sentry wards placed per 10 minutes." },
  dust: { label: "Dust", def: "Dust of Appearance used per 10 minutes." },
  smokes: { label: "Smokes", def: "Smokes of Deceit used per 10 minutes." },
  stacks: { label: "Stacks", def: "Neutral camps stacked per game, compared with what the position stacks in a game that long. Stacking is early-game work, so a per-minute rate would punish long games." },
  heal: { label: "Healing", def: "Healing done to allied heroes per minute." },
  deaths: { label: "Deaths", def: "Deaths per 10 minutes. Fewer is better." },
  dead: { label: "Time dead", def: "Share of the game spent dead. Fewer is better: a dead core isn't farming either." },
  tanked: { label: "Damage per life", def: "Hero damage taken for each death (damage taken ÷ (deaths + 1)): soaking a lot of damage without dying is good." },
};

// Stats compared with the position's line fit on game length instead of a flat average.
const LENGTH_FIT = new Set(["gpm", "nw", "stacks"]);

// Fixed rating cutoffs, same for cores and supports (both are scored against their own role).
// With the curve fitted to the AD2L pool these split it about 8/20/32/26/14%.
export const TIERS = [
  { tier: "S", min: 85 },
  { tier: "A", min: 65 },
  { tier: "B", min: 45 },
  { tier: "C", min: 30 },
  { tier: "D", min: -Infinity },
];

const keyOf = (p) => p.player_key ?? p.name.trim().toLowerCase();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
const sdOf = (xs, mu = mean(xs)) => Math.sqrt(mean(xs.map((v) => (v - mu) ** 2)));
const share = (v, total) => (v != null && total ? v / total : null);
const lerp = ([a, b], t) => a + (b - a) * clamp(t, 0, 1);
const teamKey = (name) => String(name ?? "").trim().toLowerCase();

// Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, error < 1.5e-7).
function phi(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
const DEFAULT_CURVE = [50, 17];
export const ratingOf = (score, [center, spread] = DEFAULT_CURVE) => 100 * phi((score - center) / spread);

// Average observers up at once: each ward's lifetime (capped at its 6 min duration; still up
// at the end = until the end) summed, over the game's length.
function observerUptime(obs, durSec) {
  if (!Array.isArray(obs)) return null;
  let sec = 0;
  for (let i = 0; i < obs.length; i += 5) {
    const placed = obs[i + 2], life = obs[i + 3];
    sec += clamp(life >= 0 ? life : durSec - placed, 0, 360);
  }
  return sec / durSec;
}

// Gold + XP at 10 minutes (null if the replay doesn't have both).
const at10 = (p) => (Array.isArray(p.gold_t) && p.gold_t[10] != null && p.xp10 != null ? p.gold_t[10] + p.xp10 : null);
// Who a position lanes against: cores their opposite core, supports their lane pair vs the
// enemy pair (safe lane 1+5 vs off lane 3+4, and the reverse).
const LANE_US = { 1: [1], 2: [2], 3: [3], 4: [3, 4], 5: [1, 5] };
const LANE_THEM = { 1: [3], 2: [2], 3: [1], 4: [1, 5], 5: [3, 4] };
function laneResult(pos, team, enemy) {
  const sum = (side, ps) => {
    let t = 0;
    for (const q of ps) {
      const pl = side.find((x) => x.position === q), v = pl && at10(pl);
      if (v == null) return null;
      t += v;
    }
    return t;
  };
  const us = sum(team, LANE_US[pos]), them = sum(enemy, LANE_THEM[pos]);
  return us == null || them == null ? null : us - them;
}

// One row per player per game: role, position, metrics (null = not in this game's data) and
// the raw numbers the breakdown shows next to the shares.
function gameRows(m) {
  const minutes = m.duration_sec / 60;
  const rows = [];
  for (const t of ["a", "b"]) {
    const team = m.players.filter((p) => p.team === t), enemy = m.players.filter((p) => p.team !== t);
    const sum = (f) => team.reduce((s, p) => s + (f(p) ?? 0), 0);
    const kills = t === "a" ? m.score_a : m.score_b;
    const gold = sum((p) => p.gpm), xp = sum((p) => p.xpm), dmg = sum((p) => p.hero_damage);
    const tower = team.every((p) => p.tower_damage != null) ? sum((p) => p.tower_damage) : null;
    const byNw = [...team].sort((x, y) => y.net_worth - x.net_worth);
    for (const p of team) {
      const pos = p.position ?? byNw.indexOf(p) + 1;
      const parsed = p.obs_placed != null;
      const per10 = (v) => (v != null ? (v / minutes) * 10 : null);
      rows.push({
        p, match: m, pos, role: pos <= 3 ? "core" : "support", won: m.winner === t, minutes,
        series: String(m.series_id ?? m.id ?? m.match_id),
        us: teamKey(t === "a" ? m.team_a : m.team_b), them: teamKey(t === "a" ? m.team_b : m.team_a),
        raw: { gpm: p.gpm, xpm: p.xpm, dmg: p.hero_damage, tower: p.tower_damage ?? null, kills: p.kills, assists: p.assists, taken: p.dmg_taken ?? null },
        metrics: {
          farm: share(p.gpm, gold), gpm: p.gpm ?? null, nw: p.net_worth ?? null,
          dmg: share(p.hero_damage, dmg), xp: share(p.xpm, xp),
          tower: tower ? share(p.tower_damage, tower) : null,
          kills: kills ? p.kills / kills : null, assists: kills ? p.assists / kills : null,
          lanewin: p.position != null ? laneResult(p.position, team, enemy) : null,
          lane: p.lane_eff ?? null,
          stuns: p.stuns != null ? p.stuns / minutes : null,
          vision: parsed ? observerUptime(p.obs_pos, m.duration_sec) : null,
          dewards: parsed ? per10((p.obs_killed ?? 0) + 0.5 * (p.sen_killed ?? 0)) : null,
          sentries: parsed ? per10(p.sen_placed) : null,
          dust: per10(p.dust_used), smokes: per10(p.smoke_used),
          stacks: p.camps_stacked,
          heal: p.hero_healing != null ? p.hero_healing / minutes : null,
          deaths: per10(p.deaths),
          dead: p.time_dead != null ? p.time_dead / m.duration_sec : null,
          tanked: p.dmg_taken != null ? p.dmg_taken / (p.deaths + 1) : null,
        },
      });
    }
  }
  return rows;
}

// A position's reference for a stat: [mean, sd], or [a, b, sd] for a line a + b·minutes.
const expected = (ref, minutes) => (ref.length === 3 ? ref[0] + ref[1] * minutes : ref[0]);
// Every metric a role is scored on: its stats plus survival's parts.
const scoredMetrics = (role) => ({ ...WEIGHTS[role], ...SURVIVAL });

// Each row's capped, direction-flipped z per metric (higher = better) and the value it was
// compared with.
function scoreRow(row, model) {
  row.z = {}; row.exp = {};
  for (const [metric, w] of Object.entries(scoredMetrics(row.role))) {
    const v = row.metrics[metric], ref = model.positions[row.pos]?.[metric];
    if (v == null || !ref) continue;
    const e = expected(ref, row.minutes), sd = ref[ref.length - 1];
    row.exp[metric] = e;
    row.z[metric] = sd > 0 ? clamp((v - e) / sd, -Z_CAP, Z_CAP) * Math.sign(w) : 0;
  }
  return row;
}

// Series rows: one per player, series and role, with each metric's average z and how many of
// its games had that metric.
function seriesRows(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = `${keyOf(r.p)}|${r.series}|${r.role}`;
    const m = r.match;
    const s = by.get(k) ?? {
      key: keyOf(r.p), role: r.role, series: r.series, games: 0, wins: 0, z: {}, n: {},
      vs: (r.p.team === "a" ? m.team_b : m.team_a) ?? null, time: m.start_time ?? (m.createdAt ? +new Date(m.createdAt) / 1000 : null),
    };
    s.games++;
    if (r.won) s.wins++;
    for (const [metric, z] of Object.entries(r.z)) { s.z[metric] = (s.z[metric] ?? 0) + z; s.n[metric] = (s.n[metric] ?? 0) + 1; }
    by.set(k, s);
  }
  for (const s of by.values()) for (const m of Object.keys(s.z)) s.z[m] /= s.n[m];
  return [...by.values()];
}

// A z on the role's 0–100 scale for that metric (linear100 uncapped, score100 capped).
const linear100 = (z, [lo, hi]) => (hi > lo ? ((z - lo) / (hi - lo)) * 100 : 50);
const score100 = (z, lohi) => clamp(linear100(z, lohi), 0, 100);

// Shares over the metrics present: |w| / the sum of |w| for those metrics.
function shares(weights, present) {
  const ws = Object.entries(weights).filter(([m]) => present.has(m));
  const total = ws.reduce((s, [, w]) => s + Math.abs(w), 0);
  return Object.fromEntries(ws.map(([m, w]) => [m, Math.abs(w) / total]));
}

// Share of the pool's wins that took longer than this one (ties count half).
function winSpeed(minutes, sorted) {
  if (!sorted.length) return 50;
  let longer = 0, same = 0;
  for (const m of sorted) { if (m > minutes + 1e-9) longer++; else if (Math.abs(m - minutes) <= 1e-9) same++; }
  return ((longer + same / 2) / sorted.length) * 100;
}

// Each team's game results from `rows`: team -> [{ opp, won }] (one entry per game).
function teamGames(rows) {
  const seen = new Set(), by = new Map();
  for (const r of rows) {
    const k = `${r.match.id ?? r.match.match_id}|${r.us}`;
    if (seen.has(k) || !r.us) continue;
    seen.add(k);
    (by.get(r.us) ?? by.set(r.us, []).get(r.us)).push({ opp: r.them, won: r.won });
  }
  return by;
}
// An opponent's game win % outside games against `us`, shrunk toward 50% by K_PRIOR games.
function oppStrength(teams, them, us) {
  const gs = (teams.get(them) ?? []).filter((g) => g.opp !== us);
  return (gs.filter((g) => g.won).length + K_PRIOR / 2) / (gs.length + K_PRIOR);
}

// A player's average z per metric over some games, padded with K_SHRINK games at 0 (the
// position average): { metric: [shrunk z, games] }.
function shrunkZ(rrows) {
  const sum = {}, n = {};
  for (const r of rrows) for (const [m, z] of Object.entries(r.z)) { sum[m] = (sum[m] ?? 0) + z; n[m] = (n[m] ?? 0) + 1; }
  return Object.fromEntries(Object.keys(sum).map((m) => [m, [sum[m] / (n[m] + K_SHRINK), n[m]]]));
}

// Per player and role: each metric's 0–100 from their shrunk average, plus their average value
// and position expectation for the breakdown.
function metricScores(rl, rrows, weights, anchors) {
  const zs = shrunkZ(rrows), sum = {}, n = {};
  for (const [m, [z, games]] of Object.entries(zs)) {
    if (!(m in weights)) continue;
    sum[m] = z; n[m] = games;
  }
  const sh = shares(weights, new Set(Object.keys(n)));
  return Object.keys(sh).map((m) => {
    const with_ = rrows.filter((r) => r.z[m] != null);
    const rawKey = { farm: "gpm", dmg: "dmg", tower: "tower", xp: "xpm", kills: "kills", assists: "assists", tanked: "taken" }[m];
    const rawVals = rawKey ? with_.map((r) => r.raw[rawKey]).filter((v) => v != null) : [];
    return {
      metric: m, weight: weights[m], share: sh[m], games: n[m],
      score: score100(sum[m], anchors[rl][m]), linear: linear100(sum[m], anchors[rl][m]),
      value: mean(with_.map((r) => r.metrics[m])), avg: mean(with_.map((r) => r.exp[m])),
      raw: rawVals.length ? mean(rawVals) : null,
    };
  }).sort((x, y) => y.share - x.share);
}

// Score every player in `rows` against `model` (rows must already be scored). With
// `consistency: false` (while the model is being built) consistency counts as 1.
function scorePlayers(rows, model, { consistency = true } = {}) {
  const series = seriesRows(rows), teams = teamGames(rows);
  const byPlayer = new Map();
  for (const r of rows) {
    const k = keyOf(r.p);
    const a = byPlayer.get(k) ?? { key: k, p: r.p, rows: [], series: [], teams: {}, heroes: {}, rank_tier: null };
    a.rows.push(r);
    a.heroes[r.p.hero] = (a.heroes[r.p.hero] ?? 0) + 1;
    if (r.p.rank_tier != null) a.rank_tier = r.p.rank_tier;
    if (r.p.team_name && !r.p.standin) a.teams[r.p.team_name] = (a.teams[r.p.team_name] ?? 0) + 1;
    else if (r.p.team_name) a.teams[r.p.team_name] ??= 0;
    byPlayer.set(k, a);
  }
  for (const s of series) byPlayer.get(s.key).series.push(s);

  return [...byPlayer.values()].map((a) => {
    const games = a.rows.length, wins = a.rows.filter((r) => r.won).length;
    const roleGames = { core: 0, support: 0 };
    for (const r of a.rows) roleGames[r.role]++;
    const role = roleGames.core >= roleGames.support ? "core" : "support";

    // Stat points and survival, per role, then weighted by games in each role.
    const roles = [];
    for (const rl of ["core", "support"]) {
      if (!roleGames[rl]) continue;
      const rrows = a.rows.filter((r) => r.role === rl);
      const stats = metricScores(rl, rrows, WEIGHTS[rl], model.anchors);
      const surv = metricScores(rl, rrows, SURVIVAL, model.anchors);
      roles.push({
        role: rl, games: roleGames[rl], stats, survival: surv,
        points: stats.reduce((t, s) => t + s.share * s.score, 0),
        survivalScore: surv.length ? surv.reduce((t, s) => t + s.share * s.score, 0) : null,
      });
    }
    const scored = roles.filter((r) => r.stats.length);
    const scoredGames = scored.reduce((t, r) => t + r.games, 0);
    for (const r of roles) r.frac = scoredGames && r.stats.length ? r.games / scoredGames : 0;
    const statPoints = scoredGames ? scored.reduce((t, r) => t + r.frac * r.points, 0) : 50;
    // Each stat's points toward the stat subtotal: 100 × the role's share of games × its share × 0–100.
    for (const r of roles) for (const s of r.stats) { s.max = 100 * r.frac * s.share; s.points = (s.max * s.score) / 100; }
    const survRoles = roles.filter((r) => r.survivalScore != null);
    const survGames = survRoles.reduce((t, r) => t + r.games, 0);
    const survival = survGames ? survRoles.reduce((t, r) => t + r.games * r.survivalScore, 0) / survGames : 50;

    // Each series' stat points, built so that the series (weighted by games) average to exactly
    // the season's: the series' average z per stat gets the same padding as the season
    // (× n / (n + K_SHRINK), n = the season's games with that stat), isn't capped on its own,
    // and takes the season's cap as a shift; a stat missing from some games counts in
    // proportion to the games that had it.
    for (const s of a.series) {
      const r = roles.find((x) => x.role === s.role);
      if (!r?.stats.length) { s.points = null; continue; }
      s.points = r.stats.reduce((t, st) => {
        if (s.z[st.metric] == null) return t;
        const sc = linear100((s.z[st.metric] * st.games) / (st.games + K_SHRINK), model.anchors[s.role][st.metric]) + (st.score - st.linear);
        return t + (st.share * sc * s.n[st.metric] * r.games) / (s.games * st.games);
      }, 0);
    }
    const scoredSeries = a.series.filter((s) => s.points != null);
    const seriesPts = scoredSeries.map((s) => s.points);

    // Consistency: spread of the player's series stat points, pulled toward the pool's typical
    // spread by K_CONSISTENCY series.
    const c = model.consistency;
    let spread = null, consistencyScore = 50;
    if (c) {
      const dof = Math.max(0, seriesPts.length - 1);
      spread = (dof * (seriesPts.length > 1 ? sdOf(seriesPts) : 0) + K_CONSISTENCY * c.typical) / (dof + K_CONSISTENCY);
      consistencyScore = c.worst > c.best ? clamp(((c.worst - spread) / (c.worst - c.best)) * 100, 0, 100) : 50;
    }

    // Opponents: each game's opponent strength -> a factor; each series takes its games' average,
    // and the season's multiplier weights each series by its stat points (a big series against a
    // strong team counts more than one against a weak team).
    const oppOf = (r) => (r.them ? oppStrength(teams, r.them, r.us) : 0.5);
    const factor = (rate) => lerp(MULT.opponents, (rate - 0.25) / 0.5);
    const oppRate = mean(a.rows.map(oppOf));
    for (const s of a.series) {
      const rs = a.rows.filter((r) => r.series === s.series && r.role === s.role);
      s.opp_rate = mean(rs.map(oppOf));
      s.opp = mean(rs.map((r) => factor(oppOf(r))));
    }
    const weighted = scoredSeries.reduce((t, s) => t + s.games * s.points, 0);
    const oppMult = weighted > 0 ? scoredSeries.reduce((t, s) => t + s.games * s.points * s.opp, 0) / weighted : mean(a.rows.map((r) => factor(oppOf(r))));

    const winRows = a.rows.filter((r) => r.won);
    const winShrunk = (wins + K_PRIOR * 0.5) / (games + K_PRIOR);
    const win = clamp(((winShrunk - 0.25) / 0.5) * 100, 0, 100);
    const speed = (winRows.reduce((s, r) => s + winSpeed(r.minutes, model.win_minutes), 0) + K_SPEED * 50) / (winRows.length + K_SPEED);
    const winning = (WIN_PARTS.win * win + WIN_PARTS.speed * speed) / (WIN_PARTS.win + WIN_PARTS.speed);

    const mult = {
      survival: lerp(MULT.survival, survival / 100),
      consistency: consistency ? lerp(MULT.consistency, consistencyScore / 100) : 1,
      opponents: oppMult,
      winning: lerp(MULT.winning, winning / 100),
    };
    const score = statPoints * mult.survival * mult.consistency * mult.opponents * mult.winning;
    const teamEntries = Object.entries(a.teams).sort((x, y) => y[1] - x[1]);
    return {
      key: a.key, name: a.p.name, account_id: a.p.account_id ?? null, rank_tier: a.rank_tier,
      team: teamEntries[0]?.[0] ?? null, standin: teamEntries.length > 0 && teamEntries[0][1] === 0,
      role, games, wins, role_games: roleGames,
      roles: roles.sort((x, y) => (x.role === role ? -1 : y.role === role ? 1 : 0)),
      // Per series: stat points, and a score = those × that series' opponent factor × the
      // season's survival, consistency and winning. Both average (weighted by games) to the
      // season's stat points and score.
      series: a.series.map((s) => ({
        series: s.series, role: s.role, games: s.games, wins: s.wins, vs: s.vs, time: s.time,
        points: s.points, opp: s.opp, opp_rate: s.opp_rate,
        score: s.points == null ? null : s.points * s.opp * mult.survival * mult.consistency * mult.winning,
      })).sort((x, y) => (y.time ?? 0) - (x.time ?? 0)),
      series_points: seriesPts,
      stat_points: statPoints, survival, consistency: consistencyScore, spread, opp_rate: oppRate,
      win_minutes: winRows.length ? mean(winRows.map((r) => r.minutes)) : null,
      win_shrunk: winShrunk, win, speed, winning, mult, score,
      top_heroes: Object.entries(a.heroes).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([h]) => h),
    };
  });
}

// Least-squares line y = a + b·x, and the spread of what's left over.
function lineFit(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  const b = sxx > 0 ? sxy / sxx : 0, a = my - b * mx;
  return [a, b, sdOf(ys.map((y, i) => y - (a + b * xs[i])), 0)];
}

// [lowest, highest] of a list, or null with fewer than two.
// Stats where 100 is reached before the league's best: a few supports stack far more than
// everyone else, so 100 stacks sits 70% of the way from the worst to the best.
export const EASE = { support: { stacks: 0.7 } };

const ends = (xs) => (xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null);

// The reference a tier list is scored against. `matches` is the league's games: one AD2L
// division, or the scrim ledger.
export function tierModel(matches) {
  const rows = matches.flatMap(gameRows);
  const positions = {};
  for (const pos of [1, 2, 3, 4, 5]) {
    const here = rows.filter((r) => r.pos === pos);
    positions[pos] = {};
    for (const metric of Object.keys(METRICS)) {
      const with_ = here.filter((r) => r.metrics[metric] != null);
      if (with_.length < 2) continue;
      const vs = with_.map((r) => r.metrics[metric]);
      positions[pos][metric] = LENGTH_FIT.has(metric) ? lineFit(with_.map((r) => r.minutes), vs) : [mean(vs), sdOf(vs)];
    }
  }
  const model = { games: matches.length, positions, anchors: {}, win_minutes: rows.filter((r) => r.won && r.pos === 1).map((r) => r.minutes).sort((a, b) => a - b) };
  for (const r of rows) scoreRow(r, model);
  // Anchors: every player with MIN_GAMES+ games in a role, their shrunk average per stat; the
  // best and worst of those set 100 and 0.
  const byPlayerRole = new Map();
  for (const r of rows) { const k = `${keyOf(r.p)}|${r.role}`; (byPlayerRole.get(k) ?? byPlayerRole.set(k, []).get(k)).push(r); }
  for (const role of ["core", "support"]) {
    model.anchors[role] = {};
    const players = [...byPlayerRole.values()].filter((rs) => rs[0].role === role && rs.length >= MIN_GAMES).map(shrunkZ);
    for (const metric of Object.keys(scoredMetrics(role))) {
      // Too few players to find a best and a worst: fall back to ±1 sd.
      const [lo, hi] = ends(players.filter((z) => z[metric]).map((z) => z[metric][0])) ?? [-1, 1];
      // Some stats are easier to max: 100 sits part of the way to the best player.
      model.anchors[role][metric] = [lo, lo + (hi - lo) * (EASE[role]?.[metric] ?? 1)];
    }
  }
  // Consistency reference: eligible players' series spreads (2+ series).
  const first = scorePlayers(rows, model, { consistency: false }).filter((p) => p.games >= MIN_GAMES && p.series_points.length >= 2);
  const sds = first.map((p) => sdOf(p.series_points)).sort((a, b) => a - b);
  if (sds.length) {
    const typical = sds[Math.floor(sds.length / 2)];
    // Anchors on the shrunk spreads, the same way players are scored.
    const shrunk = first.map((p) => { const dof = p.series_points.length - 1; return (dof * sdOf(p.series_points) + K_CONSISTENCY * typical) / (dof + K_CONSISTENCY); });
    const e = ends(shrunk);
    model.consistency = { typical, best: e ? e[0] : typical * 0.5, worst: e ? e[1] : typical * 1.5 };
  }
  const scores = scorePlayers(rows, model).filter((p) => p.games >= MIN_GAMES).map((p) => p.score).sort((a, b) => a - b);
  model.curve = scores.length >= 5 ? [scores[Math.floor(scores.length / 2)], RATING_STRETCH * sdOf(scores)] : DEFAULT_CURVE;
  return model;
}

export function tierList(matches, { minGames = MIN_GAMES, model = null } = {}) {
  model ??= tierModel(matches);
  const rows = matches.flatMap(gameRows).map((r) => scoreRow(r, model));
  const players = scorePlayers(rows, model);
  for (const p of players) { p.rating_exact = ratingOf(p.score, model.curve); p.rating = Math.round(p.rating_exact); p.curve = model.curve; }

  const eligible = players.filter((p) => p.games >= minGames).sort((a, b) => b.score - a.score);
  for (const p of eligible) p.tier = TIERS.find((t) => p.rating_exact >= t.min).tier;

  return {
    tiers: TIERS.map(({ tier }) => ({ tier, players: eligible.filter((p) => p.tier === tier) })),
    unranked: players.filter((p) => p.games < minGames).sort((a, b) => b.games - a.games),
    eligible: eligible.length,
    curve: model.curve,
    model,
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
