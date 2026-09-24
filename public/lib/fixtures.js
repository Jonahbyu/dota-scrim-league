// Scrim fixtures: scrims people put on the schedule ahead of time, predictions on them, and
// the uploaded games that settle them.
//
// A fixture is { id, team_a, team_b, start: Date, best_of: 1 | 2 | 3 }. team_a is "home"
// (the pick buttons and odds use AD2L's home/tie/away). Nothing links a saved game to a
// fixture: a game settles one when it's between the same two teams (names compared ignoring
// case) and was uploaded from 2 hours before the start to 3 days after. If two fixtures
// between the same teams could claim a game, the one whose start is closest gets it. A
// fixture takes games until it's decided, earliest upload first.

import { fitRatings, seriesOdds, TIE_EDGE } from "./predict.js";

export const BEFORE_MS = 2 * 3600e3;
export const AFTER_MS = 3 * 864e5;

const k = (s) => (s ?? "").trim().toLowerCase();

// Which fixture side won a game: "home", "away", or null if the teams don't match.
function sideWon(f, m) {
  const a = k(m.team_a), b = k(m.team_b), h = k(f.team_a), w = k(f.team_b);
  if (a === h && b === w) return m.winner === "a" ? "home" : "away";
  if (a === w && b === h) return m.winner === "a" ? "away" : "home";
  return null;
}

export const outcomes = (bestOf) => (bestOf === 2 ? ["home", "tie", "away"] : ["home", "away"]);
const need = (bestOf) => (bestOf === 3 ? 2 : bestOf); // wins to take a Bo3; games for Bo1/Bo2
const decided = (bestOf, hw, aw) => (bestOf === 3 ? Math.max(hw, aw) >= 2 : hw + aw >= need(bestOf));

// fixtures + saved games → fixtures with { games, home_wins, away_wins, done, outcome }.
export function settle(fixtures, matches) {
  const got = new Map(fixtures.map((f) => [f.id, { games: [], home: 0, away: 0 }]));
  const byUpload = matches.filter((m) => m.createdAt).sort((x, y) => x.createdAt - y.createdAt);
  for (const m of byUpload) {
    const t = +m.createdAt;
    const open = fixtures.filter((f) => {
      const g = got.get(f.id);
      return sideWon(f, m) && t >= +f.start - BEFORE_MS && t <= +f.start + AFTER_MS && !decided(f.best_of, g.home, g.away);
    }).sort((x, y) => Math.abs(t - x.start) - Math.abs(t - y.start));
    if (!open.length) continue;
    const f = open[0], g = got.get(f.id);
    g.games.push(m);
    g[sideWon(f, m)]++;
  }
  return fixtures.map((f) => {
    const g = got.get(f.id);
    const done = decided(f.best_of, g.home, g.away);
    const outcome = !done ? null : g.home === g.away ? "tie" : g.home > g.away ? "home" : "away";
    return { ...f, games: g.games, home_wins: g.home, away_wins: g.away, done, outcome };
  });
}

// A settled fixture in the shape predict.js scores (validPicks / standings / crowd): time in
// unix seconds; a score only once it's decided (0–0 reads as not played).
export const asSeries = (f) => ({
  id: f.id, time: Math.floor(+f.start / 1000),
  home_score: f.done ? f.home_wins : 0, away_score: f.done ? f.away_wins : 0,
});

// Team strength from every scrim result uploaded before `before` (ms), same fit as AD2L but
// with no medal prior: an unknown team starts even, and the pull keeps a team with one win
// from looking unbeatable.
export function scrimRatings(matches, before = Infinity) {
  const played = matches.filter((m) => m.createdAt && +m.createdAt < before && m.winner);
  const names = new Set(played.flatMap((m) => [k(m.team_a), k(m.team_b)]));
  const teams = [...names].map((id) => ({ id, players: [] }));
  const series = played.map((m) => ({ home: k(m.team_a), away: k(m.team_b), time: 0, home_score: m.winner === "a" ? 1 : 0, away_score: m.winner === "b" ? 1 : 0 }));
  return fitRatings(teams, series, { lambda: 1, beta: 0 });
}

// Odds for each outcome of a fixture, from one-game odds p for the home team.
export function fixtureOdds(f, ratings) {
  const p = seriesOdds(ratings.get(k(f.team_a)) ?? 0, ratings.get(k(f.team_b)) ?? 0).game;
  if (f.best_of === 1) return { game: p, home: p, away: 1 - p };
  if (f.best_of === 3) return { game: p, home: p * p * (3 - 2 * p), away: (1 - p) ** 2 * (1 + 2 * p) };
  return seriesOdds(ratings.get(k(f.team_a)) ?? 0, ratings.get(k(f.team_b)) ?? 0);
}

// The model's call: the favourite, or 1–1 in a Bo2 that's a coin flip.
export function fixtureCall(f, o) {
  if (f.best_of === 2 && Math.abs(o.game - 0.5) < TIE_EDGE) return "tie";
  return o.game >= 0.5 ? "home" : "away";
}

// What the model would have called on each decided fixture from games uploaded before it.
export function fixtureBacktest(settled, matches) {
  return settled.filter((f) => f.done).map((f) => {
    const o = fixtureOdds(f, scrimRatings(matches, +f.start));
    const pick = fixtureCall(f, o);
    return { s: asSeries(f), pick, actual: f.outcome, correct: pick === f.outcome, p_actual: o[f.outcome] };
  });
}

// "Team 2–0", "1–1", "Team wins" for a pick on a fixture.
export function outcomeLabel(f, o) {
  if (o === "tie") return "1–1";
  const t = o === "home" ? f.team_a : f.team_b;
  return f.best_of === 2 ? `${t} 2–0` : `${t} wins`;
}
