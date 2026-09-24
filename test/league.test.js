import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateMatch, parseDuration } from "../public/lib/validate.js";
import { canonicalHero, matchHero } from "../public/lib/heroes.js";
import { withDerived, playerLeaderboard, heroStats, fingerprint, matchId } from "../public/lib/stats.js";

// A real scrim's numbers with the team and player names replaced.
const sample = () => JSON.parse(readFileSync(new URL("./fixtures/game.json", import.meta.url), "utf8"));
// The stored shape (what Firestore holds): duration in seconds instead of "mm:ss".
const stored = () => { const m = sample(); m.duration_sec = parseDuration(m.duration); delete m.duration; return m; };

test("hero names match regardless of case and spacing", () => {
  assert.equal(canonicalHero("RINGMASTER"), "Ringmaster");
  assert.equal(canonicalHero("Ring Master"), "Ringmaster");
  assert.equal(canonicalHero("shadow demon"), "Shadow Demon");
  assert.equal(canonicalHero("Not A Hero"), null);
});

test("OCR hero text snaps to the closest hero only when close", () => {
  assert.equal(matchHero("VENGEFUL SP1RIT"), "Vengeful Spirit");
  assert.equal(matchHero("EARTHSHAKFR"), "Earthshaker");
  assert.equal(matchHero("XQZJW"), null);
});

test("duration parsing", () => {
  assert.equal(parseDuration("44:43"), 2683);
  assert.equal(parseDuration("1:02:03"), 3723);
  assert.equal(parseDuration("44.43"), null);
});

test("sample game passes with no errors or warnings", () => {
  const r = validateMatch(sample());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("a misread kill count is flagged but still saveable", () => {
  const m = sample();
  m.players[1].kills = 19;
  const r = validateMatch(m);
  assert.ok(r.ok);
  assert.ok(r.warnings.some((w) => w.includes("Team A players have 39 kills")));
});

test("a GPM with a dropped digit is flagged against net worth", () => {
  const m = sample();
  m.players[3].gpm = 41; // real value 411
  const r = validateMatch(m);
  assert.ok(r.warnings.some((w) => w.includes("GPM 41 is too low")));
  // None of the real rows trip it.
  assert.ok(!validateMatch(sample()).warnings.some((w) => w.includes("GPM")));
});

test("missing values, fake/duplicate heroes and out-of-range values are errors", () => {
  const m = sample();
  m.players[0].hero_damage = null;
  m.players[1].hero = "Pudgemaster";
  m.players[2].hero = "Kez";
  m.players[3].level = 31;
  m.duration = "1:30";
  const r = validateMatch(m);
  assert.equal(r.ok, false);
  for (const s of ["hero damage", "isn't a known hero", "Kez appears twice", "level must be 1–30", "between 2:00"]) {
    assert.ok(r.errors.some((e) => e.includes(s)), `expected an error mentioning "${s}"`);
  }
});

test("same game from either team gets the same id", async () => {
  const a = stored();
  // The other team's screenshot lists them first: names and kill scores both swap.
  const b = { ...a, team_a: a.team_b, team_b: a.team_a, score_a: a.score_b, score_b: a.score_a };
  assert.equal(fingerprint(a), fingerprint(b));
  assert.equal(await matchId(a), await matchId(b));
  assert.match(await matchId(a), /^[0-9a-f]{32}$/);
});

test("derived stats match hand calculations", () => {
  const m = withDerived(stored());
  const by = (n) => m.players.find((p) => p.name === n);
  assert.equal(by("Player 6").dmg_per_min, 715); // Kez
  assert.equal(by("Player 9").dmg_per_1k_nw, 1792); // Ringmaster
  assert.equal(Math.round(by("Player 2").kill_participation * 100), 83); // Earthshaker
  assert.equal(m.teamTotals.a.hero_damage, 100569);
  assert.equal(m.teamTotals.b.hero_damage, 108609);
});

test("league players are keyed by account, not name, and stand-ins are attributed", () => {
  const g1 = stored();
  const g2 = stored();
  // Two different people called "Twin" on opposite teams; player 1 also stands in for team B.
  g1.players[0] = { ...g1.players[0], name: "Twin", player_key: "111", team_name: "Alpha", standin: false };
  g1.players[5] = { ...g1.players[5], name: "Twin", player_key: "222", team_name: "Bravo", standin: false };
  g2.players[5] = { ...g2.players[5], name: "Twin", player_key: "111", team_name: "Bravo", standin: true };
  const rows = playerLeaderboard([g1, g2]).filter((r) => r.name === "Twin");
  assert.equal(rows.length, 2);
  const p111 = rows.find((r) => r.team === "Alpha");
  assert.equal(p111.games, 2);
  assert.equal(p111.standin, false);
  assert.equal(p111.standin_games, 1);
});

test("leaderboards aggregate across games", () => {
  const g1 = stored();
  const g2 = stored();
  g2.winner = "b";
  const players = playerLeaderboard([g1, g2]);
  assert.equal(players.length, 10);
  const p6 = players.find((p) => p.name === "Player 6");
  assert.equal(p6.games, 2);
  assert.equal(p6.wins, 1);
  assert.equal(p6.avg_gpm, 646);
  const heroes = heroStats([g1, g2]);
  assert.equal(heroes.find((h) => h.hero === "Kez").picks, 2);
});

test("pick order: optional, but a full unique 1-10 set when given", () => {
  const withPicks = (picks) => { const m = sample(); m.players.forEach((p, i) => { p.pick = picks[i]; }); return validateMatch(m); };
  assert.equal(withPicks([6, 7, 8, 9, 10, 5, 4, 1, 3, 2]).errors.length, 0);
  assert.ok(withPicks([6, 7, 8, 9, 10, 5, 4, 1, 3, 3]).errors.some((e) => e.includes("twice")));
  assert.ok(withPicks([6, 7, 8, 9, 11, 5, 4, 1, 3, 2]).errors.some((e) => e.includes("1–10")));
  const partial = withPicks([6, 7, null, null, null, null, null, null, null, null]);
  assert.equal(partial.errors.length, 0);
  assert.ok(partial.warnings.some((w) => w.includes("won't be saved")));
});
