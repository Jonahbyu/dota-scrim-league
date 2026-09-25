import test from "node:test";
import assert from "node:assert/strict";
import { routeOf, sharePath } from "../public/lib/share.js";

test("shareable routes map to preview paths and back", () => {
  for (const [hash, path] of [
    ["#/", "/"], ["", "/"], ["#/week", "/week/"], ["#/ad2l/", "/ad2l/"], ["#/heroic/b/week", "/heroic/b/week/"],
    ["#/heroic/a/", "/heroic/a/"], ["#/heroic/teams/14999", "/heroic/teams/14999/"], ["#/ad2l/game/8969465019", "/ad2l/game/8969465019/"],
    ["#/conqueror/", "/conqueror/"], ["#/conqueror/players", "/conqueror/players/"], ["#/conqueror/teams/14095", "/conqueror/teams/14095/"],
  ]) {
    assert.equal(sharePath(hash), path, hash);
    if (path !== "/") assert.equal(sharePath(routeOf(path)), path, `round trip ${path}`);
  }
  assert.equal(routeOf("/heroic/b/"), "#/heroic/b/");
  assert.equal(routeOf("/heroic/b/week/"), "#/heroic/b/week");
  assert.equal(routeOf("/conqueror/"), "#/conqueror/");
});

test("routes without a preview page return null", () => {
  for (const hash of ["#/heroic/a/game/123", "#/player/abc", "#/heroic/game/0123456789abcdef0123456789abcdef", "#/heroic/week/2", "#/ad2l/player/1", "#/match/abc"])
    assert.equal(sharePath(hash), null, hash);
});
