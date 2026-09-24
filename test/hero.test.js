import { test } from "node:test";
import assert from "node:assert/strict";
import { heroHistory, heroSlug } from "../public/lib/stats.js";

const P = (team, name, hero, extra = {}) => ({ team, name, hero, kills: 5, deaths: 2, assists: 5, gpm: 500, xpm: 500, hero_damage: 20000, net_worth: 15000, ...extra });
const side = (team, heroes, names) => heroes.map((h, i) => P(team, names[i], h));
const game = (id, a, b, winner, aHeroes, bHeroes, draft = null) => ({
  id, team_a: a, team_b: b, team_a_id: null, team_b_id: null, winner, score_a: 20, score_b: 10, duration_sec: 1800, createdAt: new Date(2026, 8, id),
  players: [...side("a", aHeroes, ["a1", "a2", "a3", "a4", "a5"]), ...side("b", bHeroes, ["b1", "b2", "b3", "b4", "b5"])], draft,
});
const five = (h) => [h, "Lion", "Lina", "Axe", "Sven"];
const other = ["Tiny", "Zeus", "Luna", "Lich", "Mars"];

test("heroSlug makes URL-safe names", () => {
  assert.equal(heroSlug("Nature's Prophet"), "nature-s-prophet");
  assert.equal(heroSlug("Anti-Mage"), "anti-mage");
});

test("teams, win rates, players and bans for one hero", () => {
  const draft = [{ order: 0, pick: false, side: "b", hero: "Pudge" }, { order: 7, pick: true, side: "a", hero: "Tiny" }];
  const games = [
    game(1, "Red", "Blue", "a", five("Pudge"), other),
    game(2, "Red", "Blue", "b", five("Pudge"), other),
    game(3, "Blue", "Green", "a", five("Pudge"), other),
    game(4, "Green", "Red", "b", other, five("Axe"), draft), // Tiny picked by Green at step 8; Pudge banned by Red
    { team_a: "X", team_b: "Y", winner: "a", private: true, players: [] },
  ];
  const pudge = heroHistory(games, "Pudge");
  assert.equal(pudge.summary.picks, 3);
  assert.equal(pudge.summary.wins, 2);
  const red = pudge.teams.find((t) => t.name === "Red");
  assert.deepEqual([red.picks, red.wins, red.bans], [2, 1, 1]);
  assert.equal(pudge.teams.find((t) => t.name === "Green").banned_against, 1);
  assert.equal(pudge.summary.drafted, 1);
  assert.equal(pudge.summary.ban_rate, 1);
  assert.equal(pudge.players.find((p) => p.name === "a1").games, 3);
  assert.equal(pudge.games[0].m.id, 3); // newest first

  const tiny = heroHistory(games, "Tiny");
  assert.equal(tiny.summary.avg_pick_step, 8);
  assert.equal(tiny.summary.contest_rate, 1);
});

test("a hero nobody picked has empty lists, not errors", () => {
  const h = heroHistory([game(1, "Red", "Blue", "a", five("Pudge"), other)], "Io");
  assert.equal(h.summary.picks, 0);
  assert.equal(h.summary.win_rate, null);
  assert.equal(h.best.damage, null);
});
