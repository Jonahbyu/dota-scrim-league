import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tierList, rankLabel, MIN_GAMES, K_PRIOR } from "../public/lib/tiers.js";
import { parseDuration } from "../public/lib/validate.js";

const game = () => {
  const m = JSON.parse(readFileSync(new URL("./fixtures/game.json", import.meta.url), "utf8"));
  m.duration_sec = parseDuration(m.duration);
  return m;
};

test("players need MIN_GAMES games to be ranked", () => {
  const few = tierList([game(), game()]);
  assert.equal(few.eligible, 0);
  assert.equal(few.unranked.length, 10);
  const enough = tierList([...Array(MIN_GAMES)].map(game));
  assert.equal(enough.eligible, 10);
});

test("every eligible player gets exactly one tier, best score first", () => {
  const { tiers, eligible } = tierList([...Array(4)].map(game));
  const all = tiers.flatMap((t) => t.players);
  assert.equal(all.length, eligible);
  assert.equal(new Set(all.map((p) => p.key)).size, eligible);
  const scores = all.map((p) => p.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.equal(all[0].rating, 100);
});

test("roles come from net worth: top 3 on a team are cores", () => {
  const { tiers } = tierList([...Array(3)].map(game));
  const byName = Object.fromEntries(tiers.flatMap((t) => t.players).map((p) => [p.name, p.role]));
  // Team A net worth order: Player 5, 3, 2 are the top three; 4 and 1 support.
  assert.equal(byName["Player 5"], "core");
  assert.equal(byName["Player 3"], "core");
  assert.equal(byName["Player 2"], "core");
  assert.equal(byName["Player 4"], "support");
  assert.equal(byName["Player 1"], "support");
});

test("win rate is pulled toward 50% by K_PRIOR even games", () => {
  const games = [...Array(4)].map(game);
  games[0].winner = "b"; // team A wins 3 of 4
  const { tiers } = tierList(games);
  const p = Object.fromEntries(tiers.flatMap((t) => t.players).map((x) => [x.name, x]));
  assert.equal(p["Player 1"].win_shrunk, (3 + K_PRIOR / 2) / (4 + K_PRIOR)); // 60%, not 75%
  assert.equal(p["Player 6"].win_shrunk, (1 + K_PRIOR / 2) / (4 + K_PRIOR)); // 40%, not 25%
});

test("rank labels", () => {
  assert.equal(rankLabel(80), "Immortal");
  assert.equal(rankLabel(74), "Divine 4");
  assert.equal(rankLabel(null), null);
});
