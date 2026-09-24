// Dev tool: parse the test screenshots and compare against the hand-checked samples.
// game1: scoreboard with items (unscrolled); game2: scrolled right to damage and PICK.
// Usage: node scripts/ocr-check.js [debugDir]
import { readFile } from "node:fs/promises";
import { createNodeEngine } from "../lib/ocr-node.js";
import { parseScreenshots } from "../public/lib/ocr/parse.js";

const GAMES = [
  ["data/sample-game1.json", ["test-screenshots/game1-overview.webp", "test-screenshots/game1-scoreboard.webp"]],
  ["data/sample-game2.json", ["test-screenshots/game2-overview.png", "test-screenshots/game2-scoreboard.png"]],
];
const engine = createNodeEngine({ debugDir: process.argv[2] });
const fields = ["name", "tag", "hero", "level", "kills", "deaths", "assists", "net_worth", "last_hits", "denies", "gpm", "xpm", "hero_damage", "hero_healing", "pick"];

for (const [sample, files] of GAMES) {
  const expected = JSON.parse(await readFile(sample, "utf8"));
  const t = Date.now();
  const { match, notes } = await parseScreenshots(engine, await Promise.all(files.map((f) => readFile(f))));
  const ms = Date.now() - t;

  let right = 0, total = 0;
  const wrong = [];
  const cmp = (label, got, want) => {
    total++;
    const g = typeof got === "string" ? got.trim().toLowerCase() : got;
    const w = typeof want === "string" ? want.trim().toLowerCase() : want;
    if (g === w) right++; else wrong.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  for (const k of ["team_a", "team_b", "score_a", "score_b", "winner", "duration", "game_mode"]) cmp(k, match[k], expected[k]);
  expected.players.forEach((w, i) => {
    const g = match.players[i] ?? {};
    for (const f of fields) cmp(`${w.name}.${f}`, g[f] ?? null, w[f] ?? null);
  });

  console.log(`== ${sample}`);
  console.log(wrong.length ? wrong.join("\n") : "(no mismatches)");
  if (notes?.length) console.log("\nnotes:\n" + notes.join("\n"));
  console.log(`\n${right}/${total} fields correct (${Math.round((right / total) * 100)}%) in ${ms} ms\n`);
}
await engine.terminate();
