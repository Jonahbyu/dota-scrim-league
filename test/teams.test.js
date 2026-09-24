import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listTeams, teamHistory, teamSlug, sideOf } from "../public/lib/teams.js";
import { parseDuration } from "../public/lib/validate.js";
import { fingerprint } from "../public/lib/stats.js";

const game = (extra = {}) => {
  const m = JSON.parse(readFileSync(new URL("./fixtures/game.json", import.meta.url), "utf8"));
  m.duration_sec = parseDuration(m.duration);
  m.createdAt = new Date("2026-09-20T20:00:00Z");
  return { ...m, ...extra };
};
// A private scrim as stored: result only, no players.
const privateGame = (extra = {}) => { const m = game({ private: true, ...extra }); m.players = []; return m; };

test("team slugs and sides", () => {
  assert.equal(teamSlug("Gank Me Harder Daddy!"), "gank-me-harder-daddy");
  const m = game();
  assert.equal(sideOf(m, { name: "team alpha" }), "a");
  assert.equal(sideOf(m, { name: "Team Bravo" }), "b");
  assert.equal(sideOf(m, { name: "Someone Else" }), null);
});

test("records count private results; hero pool ignores them", () => {
  const games = [game(), game({ winner: "b" }), privateGame({ winner: "a" })];
  const teams = listTeams(games);
  const alpha = teams.find((t) => t.name === "Team Alpha");
  assert.deepEqual([alpha.wins, alpha.losses], [2, 1]);
  const h = teamHistory(games, alpha);
  assert.equal(h.games.length, 3);
  assert.equal(h.private_games, 1);
  assert.equal(h.detailed.length, 2);
  assert.equal(h.heroes.find((x) => x.hero === "Shadow Demon").picks, 2); // not 3
  assert.equal(h.players.length, 5);
});

test("AD2L ids beat names, and draft tendencies split by side", () => {
  const m = game({
    team_a_id: 1, team_b_id: 2,
    draft: [
      { order: 0, pick: false, side: "a", hero: "Tusk" },
      { order: 1, pick: false, side: "b", hero: "Kez" },
      { order: 2, pick: true, side: "a", hero: "Enigma" },
    ],
  });
  const h = teamHistory([m], { id: 1, name: "renamed on PlayOn" });
  assert.equal(h.games.length, 1);
  assert.deepEqual(h.bans, [{ hero: "Tusk", n: 1 }]);
  assert.deepEqual(h.banned_against, [{ hero: "Kez", n: 1 }]);
});

test("a private upload and a public upload of the same game share an id", () => {
  const pub = game();
  const priv = privateGame();
  assert.equal(fingerprint(pub), fingerprint(priv));
  // Heroes don't feed the id, so it can't be used to guess a private game's draft.
  const other = game();
  other.players[0].hero = "Kez";
  assert.equal(fingerprint(other), fingerprint(pub));
});
