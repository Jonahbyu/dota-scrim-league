import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aliasOf, asAd2l, guessTeams, rosterQuestions } from "../public/lib/unticketed.js";
import { playerLeaderboard } from "../public/lib/stats.js";

const d = JSON.parse(readFileSync(new URL("../public/data/ad2l.json", import.meta.url), "utf8"));

// A real ticketed game reduced to what a screenshot upload holds: names, no account ids,
// team names in odd case.
const real = d.games[0];
const uploaded = {
  team_a: real.team_a.toUpperCase(), team_b: real.team_b.toLowerCase(), winner: real.winner,
  players: real.players.map((p) => ({ team: p.team, name: p.name, hero: p.hero, kills: p.kills })),
};

test("asAd2l finds both division teams and each player's account", () => {
  const g = asAd2l(uploaded, d);
  assert.equal(g.unticketed, true);
  assert.equal(g.team_a_id, real.team_a_id);
  assert.equal(g.team_b_id, real.team_b_id);
  assert.equal(g.team_a, real.team_a);
  const matched = g.players.filter((p, i) => String(p.account_id) === String(real.players[i].account_id));
  assert.equal(matched.length, 10);
  assert.deepEqual(g.players.map((p) => !!p.standin), real.players.map((p) => !!p.standin));
});

test("an uploaded game counts for the same leaderboard row as ticketed games", () => {
  const g = asAd2l(uploaded, d);
  const rows = playerLeaderboard([real, g]);
  assert.equal(rows.length, 10);
  for (const r of rows) assert.equal(r.games, 2, r.name);
  assert.deepEqual(g.players.map((p) => p.team_name), real.players.map((p) => p.team_name));
});

test("a known other name counts for that roster player", () => {
  const g = asAd2l({ team_a: "Damage Over Time", team_b: "x", players: [{ team: "a", name: "red alert", hero: "Axe" }] }, d);
  assert.equal(g.players[0].name, "Big Red");
  assert.equal(g.players[0].player_key, "80518956");
  assert.equal(g.players[0].standin, false);
});

test("unknown names and teams pass through unmatched", () => {
  const g = asAd2l({ ...uploaded, team_a: "Some Pub Team", players: [{ team: "a", name: "zzz not a player", hero: "Axe" }] }, d);
  assert.equal(g.team_a_id, null);
  assert.equal(g.team_a, "Some Pub Team");
  assert.equal(g.players[0].account_id, undefined);
});

test("guessTeams fills a misread team name from the roster majority", () => {
  const rosterNames = (id) => d.teams.find((t) => t.id === id).players.map((p) => p.name);
  const a = rosterNames(real.team_a_id), b = rosterNames(real.team_b_id);
  const m = {
    team_a: "Fl1ing Beav", team_b: real.team_b,
    players: [...a.slice(0, 5).map((name) => ({ team: "a", name })), ...b.slice(0, 5).map((name) => ({ team: "b", name }))],
  };
  const notes = guessTeams(m, d);
  assert.equal(m.team_a, real.team_a);
  assert.equal(m.team_b, real.team_b);
  assert.equal(notes.length, 1);
});

test("missing games: PlayOn score beyond the games on record, filled by uploads", async () => {
  const { missingGames, sameTeams } = await import("../public/lib/unticketed.js");
  const d = {
    teams: [{ id: 1, name: "Damage Over Time", players: [] }, { id: 2, name: "SWM.Twinks", players: [] }, { id: 3, name: "No Immortals", players: [] }],
    series: [
      { id: 10, home: 1, away: 2, home_score: 2, away_score: 0 }, // one ticketed game -> game 2 missing
      { id: 11, home: 1, away: 3, home_score: 1, away_score: 1 }, // both ticketed
      { id: 12, home: 2, away: 3 }, // not played yet
    ],
    games: [{ series_id: 10 }, { series_id: 11 }, { series_id: 11 }],
  };
  assert.deepEqual(missingGames(d).map((g) => [g.series.id, g.game]), [[10, 2]]);
  assert.deepEqual(missingGames(d, [{ series_id: 10 }]), []);
  assert.ok(sameTeams(d, d.series[0], "swm.twinks", "Damage over Time"));
  assert.ok(!sameTeams(d, d.series[0], "SWM.Twinks", "No Immortals"));
});

// Damage Over Time's roster: Fav, Big Red, Merc-Ury, Icarus, han.
const dotSide = (names) => ({ team_a: "damage over time", team_b: "Not A Division Team",
  players: [...names.map((name) => ({ team: "a", name })), ...["q", "w", "e", "r", "t"].map((name) => ({ team: "b", name }))] });

test("an unknown name on a Champion team's side asks: roster player or stand-in", () => {
  const qs = rosterQuestions(dotSide(["Fav", "Pips", "Merc-Ury", "Icarus", "han"]), d);
  assert.equal(qs.length, 1);
  assert.deepEqual({ ...qs[0] }, { i: 1, from: "Pips", team: "Damage Over Time", options: ["Big Red"] });
});

test("roster questions: closest missing name first, none for the full roster or a non-division side", () => {
  const qs = rosterQuestions(dotSide(["Fav pips", "Zed", "Merc-Ury", "Icarus", "han"]), d);
  assert.deepEqual(qs.map((q) => q.from), ["Fav pips", "Zed"]);
  assert.deepEqual(qs[0].options, ["Fav", "Big Red"]);
  assert.equal(rosterQuestions(dotSide(["Fav", "Big Red", "Merc-Ury", "Icarus", "han"]), d).length, 0);
});

test("roster questions skip known aliases, division names and names answered stand-in", () => {
  assert.equal(aliasOf(d, "red alert"), "Big Red");
  assert.equal(rosterQuestions(dotSide(["Fav", "Red Alert", "Merc-Ury", "Icarus", "han"]), d).length, 0);
  const otherTeam = d.teams.find((t) => t.name !== "Damage Over Time").players[0].name; // a known stand-in
  assert.equal(rosterQuestions(dotSide([otherTeam, "Big Red", "Merc-Ury", "Icarus", "han"]), d).length, 0);
  assert.equal(rosterQuestions(dotSide(["Pips", "Big Red", "Merc-Ury", "Icarus", "han"]), d, new Set(["pips"])).length, 0);
});
