// Reads the real test screenshots with the same OCR code the website runs.
// Slow (~5 s): it runs Tesseract. Tags are deliberately not read, so they're excluded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createNodeEngine } from "../lib/ocr-node.js";
import { parseScreenshots } from "../public/lib/ocr/parse.js";

// The screenshots and their transcription aren't in the repo (real gamertags).
const haveFixtures = existsSync(new URL("../test-screenshots/game1-scoreboard.webp", import.meta.url))
  && existsSync(new URL("../data/sample-game1.json", import.meta.url));

test("OCR reads the sample game's screenshots", { timeout: 120000, skip: !haveFixtures && "test screenshots not present" }, async () => {
  const expected = JSON.parse(readFileSync(new URL("../data/sample-game1.json", import.meta.url), "utf8"));
  const engine = createNodeEngine();
  const files = ["game1-overview.webp", "game1-scoreboard.webp"].map((f) => readFileSync(new URL(`../test-screenshots/${f}`, import.meta.url)));
  const { match } = await parseScreenshots(engine, files);
  await engine.terminate();

  // Every number, hero, team and the result must be exact.
  for (const k of ["team_a", "team_b", "score_a", "score_b", "winner", "duration"]) assert.equal(match[k], expected[k], k);
  const exact = ["hero", "level", "kills", "deaths", "assists", "net_worth", "last_hits", "denies", "gpm", "xpm", "hero_damage", "hero_healing"];
  expected.players.forEach((w, i) => {
    for (const f of exact) assert.equal(match.players[i][f], w[f], `${w.name}.${f}`);
  });
  // Names: at least 9 of 10 exact (a highlighted row can keep its clan tag).
  const names = expected.players.filter((w, i) => match.players[i].name === w.name).length;
  assert.ok(names >= 9, `only ${names}/10 names exact`);
});
