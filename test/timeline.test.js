import { test } from "node:test";
import assert from "node:assert/strict";
import { swings, teamTimeline, averageCurve, goldCurves, roleIn, byHero, hasTimeline } from "../public/lib/timeline.js";

const P = (team, hero, nw, gold_t) => ({ team, hero, name: hero, net_worth: nw, gold_t });
const players = (gold) => ["a", "a", "a", "a", "a", "b", "b", "b", "b", "b"].map((t, i) => P(t, `H${i}`, 20000 - i * 1000, gold.map((g) => g * (i + 1))));
const game = (winner, adv, extra = {}) => ({ team_a: "A", team_b: "B", winner, gold_adv: adv, players: players([0, 100, 200]), ...extra });

test("swings: biggest leads, the loser's lead (throw) and lead changes", () => {
  // A goes up 8k by minute 3, then B takes over and wins.
  const s = swings(game("b", [0, 2000, 5000, 8000, 3000, -2000, -6000]));
  assert.deepEqual(s.lead.a, { max: 8000, minute: 3 });
  assert.deepEqual(s.lead.b, { max: 6000, minute: 6 });
  assert.equal(s.loser, "a");
  assert.equal(s.thrown, 8000);
  assert.equal(s.thrown_minute, 3);
  assert.equal(s.lead_changes, 1);
  assert.equal(swings({ winner: "a" }), null);
});

test("lead changes ignore noise under 1k", () => {
  assert.equal(swings(game("a", [0, 500, -500, 800, -900, 3000])).lead_changes, 0);
});

test("teamTimeline counts comebacks and throws from the team's side", () => {
  const games = [
    game("b", [0, 3000, 7000, 1000, -4000]),  // A throws a 7k lead
    game("a", [0, -2000, -6000, 2000, 9000]), // A comes back from 6k down
    game("a", [0, 1000, 2000, 3000, 4000]),
  ];
  const t = teamTimeline(games, () => "a");
  assert.equal(t.games, 3);
  assert.equal(t.throws, 1);
  assert.equal(t.comebacks, 1);
  assert.equal(t.best_comeback.trail, 6000);
  assert.equal(t.worst_throw.led, 7000);
  // Same games from B's side: the 7k A lead is B's comeback.
  const tb = teamTimeline(games, () => "b");
  assert.equal(tb.comebacks, 1);
  assert.equal(tb.throws, 1);
  assert.deepEqual(tb.curve.slice(0, 2), [0, -667]); // (-3000 + 2000 - 1000) / 3
});

test("averageCurve stops when fewer than two games last that long", () => {
  assert.deepEqual(averageCurve([[0, 10, 20, 30], [0, 20, 40]]), [0, 15, 30]);
  assert.deepEqual(averageCurve([[0, 10, 20]]), [0, 10, 20]); // one game: draw it all
});

test("roles and gold curves", () => {
  const g = game("a", [0, 100, 200]);
  assert.equal(roleIn(g, g.players[0]), "core");
  assert.equal(roleIn(g, g.players[4]), "support");
  const c = goldCurves([g, { ...g, gold_adv: null }], byHero("H0"));
  assert.equal(c.games, 1);
  assert.deepEqual(c.mine, [0, 100, 200]);
  // Cores are each side's top 3 by net worth: gold multipliers 1,2,3,6,7,8 vs supports 4,5,9,10.
  assert.equal(c.core[2], 900);
  assert.equal(c.support[2], 1400);
  assert.equal(hasTimeline({ gold_adv: [0] }), false);
});
