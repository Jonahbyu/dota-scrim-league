import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBuilding, buildingsFrom, towerMapHtml } from "../public/lib/towermap.js";

test("parseBuilding reads OpenDota building keys", () => {
  assert.deepEqual(parseBuilding("npc_dota_goodguys_tower1_top"), { side: "a", b: "t1_top" });
  assert.deepEqual(parseBuilding("npc_dota_badguys_tower4"), { side: "b", b: "t4" });
  assert.deepEqual(parseBuilding("npc_dota_badguys_melee_rax_mid"), { side: "b", b: "melee_mid" });
  assert.deepEqual(parseBuilding("npc_dota_goodguys_fort"), { side: "a", b: "fort" });
  assert.equal(parseBuilding("npc_dota_goodguys_healers"), null);
});

test("buildingsFrom: who took it, denies, creeps, order", () => {
  const out = buildingsFrom([
    { type: "building_kill", time: 972, unit: "npc_dota_creep_badguys_melee", key: "npc_dota_goodguys_tower1_mid" },
    { type: "building_kill", time: 745, unit: "npc_dota_hero_dragon_knight", key: "npc_dota_badguys_tower1_top", player_slot: 3 },
    { type: "building_kill", time: 983, unit: "npc_dota_hero_dragon_knight", key: "npc_dota_goodguys_tower1_top", player_slot: 3 },
    { type: "CHAT_MESSAGE_ROSHAN_KILL", time: 1500, team: 2 },
  ], (slot) => (slot === 3 ? "Dragon Knight" : null));
  assert.deepEqual(out, [
    { side: "b", b: "t1_top", time: 745, by: "a", hero: "Dragon Knight" },
    { side: "a", b: "t1_mid", time: 972, by: "b", hero: null },
    { side: "a", b: "t1_top", time: 983, by: "a", hero: "Dragon Knight" }, // a deny
  ]);
  assert.equal(buildingsFrom(null), null);
});

test("towerMapHtml only offers phases the game reached", () => {
  const m = { team_a: "A", team_b: "B", duration_sec: 1500, buildings: [{ side: "a", b: "t1_mid", time: 700, by: "b", hero: null }] };
  const html = towerMapHtml(m);
  assert.match(html, /10–20'/);
  assert.match(html, /20–35'/);
  assert.doesNotMatch(html, /35'\+/);
  assert.equal(towerMapHtml({ ...m, buildings: [] }), "");
});
