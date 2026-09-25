import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listTeams, teamHistory, teamSlug, sideOf, standingsRows } from "../public/lib/teams.js";
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

test("standings: ranked by wins, with kill diff, form and streak", () => {
  const at = (d) => new Date(`2026-09-${d}T20:00:00Z`);
  const r = (a, b, sa, sb, winner, d) => ({ team_a: a, team_b: b, score_a: sa, score_b: sb, winner, duration_sec: 1800, createdAt: at(d), players: [] });
  const rows = standingsRows([
    r("Alpha", "Bravo", 30, 10, "a", 10),
    r("bravo", "Alpha", 25, 20, "a", 11), // same team, different case
    r("Alpha", "Charlie", 40, 20, "a", 12),
    { ...r("Charlie", "Bravo", 15, 18, "b", 13), private: true },
  ]);
  assert.deepEqual(rows.map((x) => [x.team, x.wins, x.losses]), [["Alpha", 2, 1], ["Bravo", 2, 1], ["Charlie", 0, 2]]);
  const alpha = rows[0];
  assert.equal(alpha.kill_diff, (20 - 5 + 20) / 3);
  assert.deepEqual(alpha.form, ["W", "L", "W"]);
  assert.equal(alpha.streak, "W1");
  assert.equal(rows[1].streak, "W2");
  assert.equal(rows[2].streak, "L2");
  assert.equal(rows[2].win_rate, 0);
});
