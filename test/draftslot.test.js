import { test } from "node:test";
import assert from "node:assert/strict";
import { draftSlotRecord } from "../public/lib/stats.js";

const game = (winner, aPicks, bPicks) => {
  const draft = [];
  let order = 0;
  for (let i = 0; i < 5; i++) {
    draft.push({ order: order++, pick: false, side: "a", hero: `banA${i}` });
    draft.push({ order: order++, pick: true, side: "a", hero: aPicks[i] });
    draft.push({ order: order++, pick: true, side: "b", hero: bPicks[i] });
  }
  const players = [...aPicks.map((h, i) => ({ team: "a", name: `a${i}`, hero: h })), ...bPicks.map((h, i) => ({ team: "b", name: `b${i}`, hero: h }))];
  return { winner, draft, players };
};

test("draftSlotRecord counts the team's pick number, not the draft step", () => {
  const ms = [
    game("a", ["H1", "H2", "H3", "H4", "Meepo"], ["X1", "X2", "X3", "X4", "X5"]),
    game("b", ["Meepo", "H2", "H3", "H4", "H5"], ["X1", "X2", "X3", "X4", "X5"]),
    game("a", ["H1", "H2", "H3", "H4", "Meepo"], ["X1", "X2", "X3", "X4", "X5"]),
  ];
  const r = draftSlotRecord(ms, (p) => p.hero === "Meepo");
  assert.equal(r.games, 3);
  assert.deepEqual(r.slots.map((s) => [s.games, s.wins]), [[1, 0], [0, 0], [0, 0], [0, 0], [2, 2]]);
  assert.equal(r.slots[4].win_rate, 1);
  assert.equal(r.slots[1].win_rate, null);
  assert.deepEqual(r.slots[4].heroes, [{ hero: "Meepo", n: 2 }]);
});

test("draftSlotRecord is null without drafts", () => {
  assert.equal(draftSlotRecord([{ winner: "a", players: [{ team: "a", hero: "Axe" }] }], () => true), null);
});
