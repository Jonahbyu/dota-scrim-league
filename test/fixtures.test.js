import { test } from "node:test";
import assert from "node:assert/strict";
import { settle, asSeries, fixtureOdds, fixtureCall, scrimRatings, fixtureBacktest, outcomes, outcomeLabel } from "../public/lib/fixtures.js";
import { standings, validPicks } from "../public/lib/predict.js";

const H = 3600e3;
const T = Date.UTC(2026, 8, 20, 1); // fixture start
const game = (a, b, winner, at) => ({ team_a: a, team_b: b, winner, createdAt: new Date(at) });
const fx = (id, best_of = 2, start = T, a = "Rats", b = "Owls") => ({ id, team_a: a, team_b: b, best_of, start: new Date(start) });

test("games settle a Bo2 by team names in either order, ignoring case", () => {
  const [f] = settle([fx("f1")], [game("rats", "OWLS", "a", T + H), game("Owls", "Rats", "a", T + 2 * H)]);
  assert.equal(f.games.length, 2);
  assert.deepEqual([f.home_wins, f.away_wins, f.done, f.outcome], [1, 1, true, "tie"]);
});

test("one game of a Bo2 isn't a result yet", () => {
  const [f] = settle([fx("f1")], [game("Rats", "Owls", "a", T + H)]);
  assert.equal(f.done, false);
  assert.equal(f.outcome, null);
  assert.deepEqual(asSeries(f), { id: "f1", time: T / 1000, home_score: 0, away_score: 0 });
});

test("a Bo3 stops at two wins; extra games stay unclaimed", () => {
  const g = [game("Rats", "Owls", "b", T + H), game("Rats", "Owls", "b", T + 2 * H), game("Rats", "Owls", "a", T + 3 * H)];
  const [f] = settle([fx("f1", 3)], g);
  assert.deepEqual([f.games.length, f.outcome, f.away_wins], [2, "away", 2]);
});

test("games outside the window or between other teams don't count", () => {
  const g = [game("Rats", "Owls", "a", T - 3 * H), game("Rats", "Owls", "a", T + 4 * 864e5), game("Rats", "Bats", "a", T + H)];
  assert.equal(settle([fx("f1", 1)], g)[0].games.length, 0);
});

test("the closest fixture gets the game", () => {
  const day = 864e5;
  const [a, b] = settle([fx("f1", 1, T), fx("f2", 1, T + day)], [game("Rats", "Owls", "a", T + day + H)]);
  assert.equal(a.games.length, 0);
  assert.equal(b.outcome, "home");
});

test("odds add up to 1 for every format", () => {
  const r = scrimRatings([game("Rats", "Owls", "a", T - H), game("Rats", "Owls", "a", T - 2 * H)]);
  for (const bo of [1, 2, 3]) {
    const o = fixtureOdds(fx("f", bo), r);
    const sum = outcomes(bo).reduce((s, x) => s + o[x], 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `Bo${bo}`);
    assert.ok(o.game > 0.5, "Rats beat Owls twice");
    assert.equal(fixtureCall(fx("f", bo), o), "home");
  }
  assert.equal(fixtureCall(fx("f", 2), fixtureOdds(fx("f", 2), new Map())), "tie");
});

test("the backtest only uses games uploaded before the fixture", () => {
  const before = [game("Owls", "Rats", "a", T - 5 * H)]; // Owls won earlier, outside the window
  const during = [game("Rats", "Owls", "a", T + H)];
  const settled = settle([fx("f1", 1)], [...before, ...during]);
  const [bt] = fixtureBacktest(settled, [...before, ...during]);
  assert.equal(bt.pick, "away");
  assert.equal(bt.actual, "home");
  assert.equal(bt.correct, false);
});

test("scrim picks score through predict.js standings, locked at the start", () => {
  const settled = settle([fx("f1", 1)], [game("Rats", "Owls", "a", T + H)]);
  const series = settled.map(asSeries);
  const preds = [
    { series_id: "f1", pick: "home", name: "Ann", updatedAt: new Date(T - H) },
    { series_id: "f1", pick: "away", name: "Bob", updatedAt: new Date(T - H) },
    { series_id: "f1", pick: "home", name: "Cal", updatedAt: new Date(T + 10) }, // late
  ];
  assert.equal(validPicks(preds, series).length, 2);
  const st = standings(preds, series);
  assert.deepEqual(st.map((r) => [r.name, r.points]), [["Ann", 1], ["Bob", 0]]);
});

test("labels", () => {
  assert.equal(outcomeLabel(fx("f", 2), "home"), "Rats 2–0");
  assert.equal(outcomeLabel(fx("f", 2), "tie"), "1–1");
  assert.equal(outcomeLabel(fx("f", 3), "away"), "Owls wins");
});
