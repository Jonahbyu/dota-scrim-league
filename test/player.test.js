import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDuration } from "../public/lib/validate.js";
import { withDerived, playerHistory, playerKey } from "../public/lib/stats.js";

const game = (createdAt, swapWinner = false) => {
  const m = JSON.parse(readFileSync(new URL("./fixtures/game.json", import.meta.url), "utf8"));
  m.duration_sec = parseDuration(m.duration); delete m.duration;
  if (swapWinner) m.winner = m.winner === "a" ? "b" : "a";
  return withDerived({ ...m, createdAt: new Date(createdAt) });
};

test("playerHistory collects one player's games, newest first, with hero pool and bests", () => {
  const games = [game("2026-09-01"), game("2026-09-08", true), { team_a: "X", team_b: "Y", winner: "a", private: true, players: [] }];
  const p = games[0].players[0];
  const h = playerHistory(games, playerKey(p));
  assert.equal(h.games.length, 2); // private game skipped
  assert.ok(h.games[0].m.createdAt > h.games[1].m.createdAt);
  assert.equal(h.summary.games, 2);
  assert.equal(h.summary.wins, 1);
  assert.equal(h.summary.key, playerKey(p));
  assert.deepEqual(h.heroes.map((x) => [x.hero, x.games, x.wins]), [[p.hero, 2, 1]]);
  assert.equal(h.best.damage.p.hero_damage, p.hero_damage);
});

test("unknown player gives null", () => {
  assert.equal(playerHistory([game("2026-09-01")], "nobody-here"), null);
});
