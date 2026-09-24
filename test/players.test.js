import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlayerIndex, matchPlayers, nameKey } from "../public/lib/players.js";

const ad2l = {
  teams: [
    { name: "Damage Over Time", players: [{ name: "Icarus" }, { name: "Merc-Ury" }, { name: "Fav" }] },
    { name: "Flying Beavers", players: [{ name: "Icarus" }, { name: "Bagged Milk" }] },
    { name: "Gank Me Harder", players: [{ name: "Kaleb" }, { name: "Lorenzo" }] },
  ],
  games: [{ players: [{ name: "Frogger", team_name: "Gank Me Harder" }, { name: "account 123", team_name: "x" }] }],
};
const side = (names, team) => names.map((name) => ({ name, team }));

test("nameKey ignores case, spaces and punctuation", () => {
  assert.equal(nameKey("Dr. Spike"), "drspike");
  assert.equal(nameKey("MERC-URY"), nameKey("Merc Ury"));
});

test("clear misreads are fixed, loose ones only suggested", () => {
  const idx = buildPlayerIndex(ad2l);
  const out = matchPlayers([...side(["Icarus<", "MERCURY", "Frogqer"], "a"), ...side(["Daddy Kaleb", "Lorenz0"], "b")], idx);
  const by = Object.fromEntries(out.map((o) => [o.from, o]));
  assert.equal(by["Icarus<"].to, "Icarus"); assert.equal(by["Icarus<"].sure, true);
  assert.equal(by["MERCURY"].to, "Merc-Ury"); assert.equal(by["MERCURY"].sure, true);
  assert.equal(by["Frogqer"].to, "Frogger"); // stand-in from the games list
  assert.equal(by["Lorenz0"].sure, true);
  assert.equal(by["Daddy Kaleb"].to, "Kaleb"); assert.equal(by["Daddy Kaleb"].sure, false);
});

test("exact known names and unknown names are left alone", () => {
  const idx = buildPlayerIndex(ad2l, [{ players: [{ name: "Daddy Kaleb" }] }]);
  assert.deepEqual(matchPlayers(side(["Daddy Kaleb", "Fav", "zzqq", "account 123"], "a"), idx), []);
});

test("teammates break ties between similar names", () => {
  const idx = buildPlayerIndex({ teams: [
    { name: "T1", players: [{ name: "Alpha1" }, { name: "Bravo" }] },
    { name: "T2", players: [{ name: "Alpha2" }, { name: "Charlie" }] },
  ] });
  const out = matchPlayers(side(["Alpha9", "Charlie"], "a"), idx);
  assert.equal(out[0].to, "Alpha2");
  assert.deepEqual(matchPlayers(side(["Alpha9"], "a"), idx), []); // no hint: ambiguous
});

test("a saved misread doesn't count as a known name", () => {
  const idx = buildPlayerIndex(ad2l, [{ players: [{ name: "Icarus<" }, { name: "MERCURY" }, { name: "Daddy Kaleb" }] }]);
  const out = matchPlayers(side(["Icarus<", "MERCURY", "Daddy Kaleb"], "b"), idx);
  assert.deepEqual(out.map((o) => [o.from, o.to, o.sure]), [["Icarus<", "Icarus", true], ["MERCURY", "Merc-Ury", true]]);
});
