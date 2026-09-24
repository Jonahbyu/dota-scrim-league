import { test } from "node:test";
import assert from "node:assert/strict";
import { wardsOf, collectWards, wardSummary } from "../public/lib/wardmap.js";

const radiant = { team: "a", name: "R", obs_pos: [100, 90, 30, 360, 0, 120, 130, 700, 45, 1], sen_pos: [80, 80, 10, -1, 0] };
const dire = { team: "b", name: "D", obs_pos: [160, 170, 50, 200, 1], sen_pos: [] };

test("wardsOf reads flat groups of 5", () => {
  const w = wardsOf(radiant);
  assert.equal(w.length, 3);
  assert.deepEqual(w[1], { kind: "obs", x: 120, y: 130, t: 700, life: 45, killed: true });
  assert.deepEqual(w[2], { kind: "sen", x: 80, y: 80, t: 10, life: -1, killed: false });
});

test("flip mirrors Dire wards to the placer's own side, leaves Radiant alone", () => {
  assert.deepEqual(wardsOf(dire, { flip: true }).map((w) => [w.x, w.y]), [[96, 86]]);
  assert.deepEqual(wardsOf(radiant, { flip: true })[0], wardsOf(radiant)[0]);
});

test("collectWards filters players and mirrors; summary counts", () => {
  const games = [{ players: [radiant, dire, { team: "a", name: "X" }] }];
  const all = collectWards(games, () => true);
  assert.equal(all.length, 4);
  assert.equal(collectWards(games, (p) => p.name === "D")[0].x, 96);
  const s = wardSummary(all);
  assert.deepEqual({ obs: s.obs, sen: s.sen, obs_killed: s.obs_killed }, { obs: 3, sen: 1, obs_killed: 2 });
  assert.equal(Math.round(s.obs_life), Math.round((360 + 45 + 200) / 3));
});
