// Minute-by-minute analysis for games that carry OpenDota's per-minute data (AD2L):
//   m.gold_adv[i]   team A's gold lead at minute i (negative = team B ahead)
//   p.gold_t[i]     a player's gold at minute i
// OpenDota's gold lead is total gold earned (the same number its own graph plots), so gold
// lost on death isn't subtracted and it can differ from the final net worth.
import { playerKey } from "./stats.js";

export const hasTimeline = (m) => Array.isArray(m.gold_adv) && m.gold_adv.length > 1;

// A lead this size or bigger counts as a real lead for throws and comebacks.
export const BIG_LEAD = 5000;

// Swings in one game: each side's biggest lead (and when), how many times the lead
// changed hands (ignoring noise under 1k), and the lead the loser had before losing.
export function swings(m) {
  if (!hasTimeline(m)) return null;
  const adv = m.gold_adv;
  let maxA = 0, minA = 0, maxB = 0, minB = 0;
  adv.forEach((v, i) => {
    if (v > maxA) { maxA = v; minA = i; }
    if (-v > maxB) { maxB = -v; minB = i; }
  });
  let changes = 0, leader = null;
  for (const v of adv) {
    const now = v >= 1000 ? "a" : v <= -1000 ? "b" : null;
    if (now && leader && now !== leader) changes++;
    if (now) leader = now;
  }
  const loser = m.winner === "a" ? "b" : "a";
  const lead = { a: { max: maxA, minute: minA }, b: { max: maxB, minute: minB } };
  const at = (min) => (adv.length > min ? adv[min] : null);
  return {
    lead,
    lead_changes: changes,
    // The biggest lead the losing team held: a throw from their side, a comeback from the winner's.
    thrown: lead[loser].max,
    thrown_minute: lead[loser].minute,
    loser,
    at10: at(10), at20: at(20),
  };
}

// Team view: the team's own-side lead in each game (positive = them ahead), plus comebacks,
// throws, and record when ahead / behind at 20 minutes.
export function teamTimeline(games, sideOf) {
  const rows = [];
  for (const m of games) {
    const side = sideOf(m);
    const s = swings(m);
    if (!side || !s) continue;
    const sign = side === "a" ? 1 : -1;
    const won = m.winner === side;
    rows.push({ m, side, won, adv: m.gold_adv.map((v) => v * sign), trail: s.lead[side === "a" ? "b" : "a"].max, led: s.lead[side].max, at20: s.at20 == null ? null : s.at20 * sign });
  }
  if (!rows.length) return null;
  const pick = (f, cmp) => rows.filter(f).sort(cmp)[0] ?? null;
  const ahead20 = rows.filter((r) => r.at20 != null && r.at20 > 0), behind20 = rows.filter((r) => r.at20 != null && r.at20 < 0);
  return {
    games: rows.length,
    curve: averageCurve(rows.map((r) => r.adv)),
    comebacks: rows.filter((r) => r.won && r.trail >= BIG_LEAD).length,
    throws: rows.filter((r) => !r.won && r.led >= BIG_LEAD).length,
    best_comeback: pick((r) => r.won && r.trail > 0, (a, b) => b.trail - a.trail),
    worst_throw: pick((r) => !r.won && r.led > 0, (a, b) => b.led - a.led),
    ahead20: { games: ahead20.length, wins: ahead20.filter((r) => r.won).length },
    behind20: { games: behind20.length, wins: behind20.filter((r) => r.won).length },
  };
}

// Average of several per-minute series. Stops once fewer than `minCount` games lasted that
// long, so one long game doesn't draw the tail on its own.
export function averageCurve(series, minCount = 2) {
  const out = [];
  const need = Math.min(minCount, series.length);
  for (let i = 0; ; i++) {
    const vals = series.map((s) => s[i]).filter((v) => v != null);
    if (vals.length < need || !vals.length) break;
    out.push(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length));
  }
  return out;
}

// Each player's role per game, same approximation as the tier list: a team's top 3 by
// net worth are cores, the other two supports.
export function roleIn(m, p) {
  const mates = m.players.filter((q) => q.team === p.team).sort((a, b) => b.net_worth - a.net_worth);
  return mates.indexOf(p) < 3 ? "core" : "support";
}

// Gold curves: one filter (a player, a hero) against the division average for cores and
// supports, so a curve can be read as "ahead of / behind a typical core".
export function goldCurves(games, match) {
  const mine = [], core = [], support = [];
  for (const m of games) {
    if (!hasTimeline(m)) continue;
    for (const p of m.players) {
      if (!Array.isArray(p.gold_t)) continue;
      (roleIn(m, p) === "core" ? core : support).push(p.gold_t);
      if (match(p, m)) mine.push(p.gold_t);
    }
  }
  return { mine: averageCurve(mine), games: mine.length, core: averageCurve(core), support: averageCurve(support) };
}

export const byPlayer = (key) => (p) => playerKey(p) === key;
export const byHero = (hero) => (p) => p.hero === hero;
