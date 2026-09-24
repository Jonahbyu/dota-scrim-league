import { test } from "node:test";
import assert from "node:assert/strict";
import { fitRatings, seriesOdds, standings, validPicks, crowd, backtest, medalSteps } from "../public/lib/predict.js";

const teams = [1, 2, 3].map((id) => ({ id, players: [{ rank_tier: 50 }] }));
const T = 1_000_000;
const series = [
  { id: 10, time: T, home: 1, away: 2, home_score: 2, away_score: 0 },
  { id: 11, time: T, home: 3, away: 1, home_score: 1, away_score: 1 },
  { id: 12, time: T + 604800, home: 2, away: 3, home_score: null, away_score: null },
];
const at = (sec) => new Date(sec * 1000);

test("odds add to 1 and a series is two independent games", () => {
  const o = seriesOdds(0.4, 0);
  assert.ok(Math.abs(o.home + o.tie + o.away - 1) < 1e-9);
  assert.ok(Math.abs(o.home - o.game ** 2) < 1e-9);
  assert.ok(Math.abs(seriesOdds(0, 0).tie - 0.5) < 1e-9);
});

test("ratings move toward results and are pulled back by lambda", () => {
  const loose = fitRatings(teams, series, { lambda: 0.5, beta: 0 });
  const tight = fitRatings(teams, series, { lambda: 50, beta: 0 });
  assert.ok(loose.get(1) > loose.get(2));
  assert.ok(Math.abs(tight.get(1) - tight.get(2)) < Math.abs(loose.get(1) - loose.get(2)));
});

test("medal steps", () => {
  assert.equal(medalSteps(11), 1);
  assert.equal(medalSteps(55), 25);
  assert.equal(medalSteps(80), 35);
});

test("picks after the start don't count; same name keeps the later pick", () => {
  const preds = [
    { series_id: 10, pick: "home", name: "Ann", uid: "a", updatedAt: at(T - 100) },
    { series_id: 10, pick: "away", name: "ann ", uid: "b", updatedAt: at(T - 50) }, // same name, later: counts
    { series_id: 11, pick: "tie", name: "Bob", uid: "c", updatedAt: at(T - 10) },
    { series_id: 10, pick: "home", name: "Bob", uid: "c", updatedAt: at(T + 10) }, // after start
  ];
  assert.equal(validPicks(preds, series).length, 2);
  const st = standings(preds, series, [{ correct: true }, { correct: false }]);
  assert.deepEqual(st.map((r) => [r.name, r.points, r.picks]), [["Bob", 1, 1], ["The model", 1, 2], ["ann ", 0, 1]]);
});

test("crowd shares for an upcoming series", () => {
  const preds = [
    { series_id: 12, pick: "home", name: "A", updatedAt: at(T) },
    { series_id: 12, pick: "home", name: "B", updatedAt: at(T) },
    { series_id: 12, pick: "tie", name: "C", updatedAt: at(T) },
  ];
  const c = crowd(preds, series[2]);
  assert.equal(c.n, 3);
  assert.ok(Math.abs(c.home - 2 / 3) < 1e-9);
});

test("backtest predicts each night only from earlier nights", () => {
  const bt = backtest(teams, series, { lambda: 1, beta: 0 });
  assert.equal(bt.length, 2); // the unplayed series isn't scored
  assert.ok(bt.every((x) => Math.abs(x.odds.game - 0.5) < 1e-9)); // first night: no results yet
});

import { readFileSync } from "node:fs";
import { predictDraft, CM_ORDER, modelCall } from "../public/lib/predict.js";

test("predicted draft follows S48's order: first-pick team bans 3/2/2, the other 4/1/2, 5 picks each, no hero twice", () => {
  const d = JSON.parse(readFileSync(new URL("../public/data/ad2l.json", import.meta.url), "utf8"));
  const [a, b] = d.teams;
  const steps = predictDraft(d, a, b, 0);
  assert.equal(steps.length, 24);
  const count = (team, kind, phase) => steps.filter((s) => s.team === team && s.kind === kind && (phase == null || s.phase === phase)).length;
  assert.deepEqual([1, 2, 3].map((ph) => count(a, "ban", ph)), [3, 2, 2]);
  assert.deepEqual([1, 2, 3].map((ph) => count(b, "ban", ph)), [4, 1, 2]);
  assert.equal(count(a, "pick"), 5);
  assert.equal(count(b, "pick"), 5);
  const heroes = steps.map((s) => s.hero).filter(Boolean);
  assert.equal(new Set(heroes).size, heroes.length);
  // every pick goes to a different player of the picking team
  for (const t of [a, b]) assert.equal(new Set(steps.filter((s) => s.team === t && s.kind === "pick").map((s) => s.player?.name)).size, 5);
  // the order matches a real S48 draft
  const real = [...d.games[0].draft].sort((x, y) => x.order - y.order);
  assert.deepEqual(CM_ORDER.map(([, k]) => k), real.map((s) => (s.pick ? "pick" : "ban")));
});

test("the model's call takes a side unless it's a coin flip", () => {
  assert.equal(modelCall({ game: 0.52 }), "home");
  assert.equal(modelCall({ game: 0.48 }), "away");
  assert.equal(modelCall({ game: 0.51 }), "tie");
  assert.equal(modelCall({ game: 0.5 }), "tie");
});
