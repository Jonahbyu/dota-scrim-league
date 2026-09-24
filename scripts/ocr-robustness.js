// Dev tool: re-run the OCR check on distorted copies of the test screenshots to see whether
// the layout detection survives other resolutions, Snipping Tool crops and JPEG compression.
// Usage: node scripts/ocr-robustness.js
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { createNodeEngine } from "../lib/ocr-node.js";
import { parseScreenshots } from "../public/lib/ocr/parse.js";

const expected = JSON.parse(await readFile("data/sample-game1.json", "utf8"));
const originals = await Promise.all(["test-screenshots/game1-overview.webp", "test-screenshots/game1-scoreboard.webp"].map((f) => readFile(f)));

// crop = fraction trimmed from [left, top, right, bottom]; negative = add dark border.
const ONLY = process.env.ONLY?.split(",");
const VARIANTS = [
  { name: "original", scale: 1 },
  { name: "0.72x (1440p-ish)", scale: 0.72 },
  { name: "1.4x (4K-ish)", scale: 1.4 },
  { name: "tight crop", crop: [0.03, 0.04, 0.0, 0.05] },
  { name: "loose crop (extra border)", crop: [-0.05, -0.06, -0.04, -0.05] },
  { name: "jpeg q70", jpeg: 70 },
  { name: "0.8x + tight + jpeg", scale: 0.8, crop: [0.02, 0.03, 0.0, 0.03], jpeg: 80 },
  // Browsers may colour-convert on decode (display profiles); simulate shifted grays.
  { name: "colour: 10% darker", modulate: 0.9 },
  { name: "colour: 10% brighter", modulate: 1.1 },
  { name: "colour: gamma 1.3", gamma: 1.3 },
];

async function distort(buf, v) {
  let img = sharp(buf).removeAlpha();
  const { width, height } = await sharp(buf).metadata();
  if (v.crop) {
    const [l, t, r, b] = v.crop;
    if (l >= 0) {
      img = img.extract({ left: Math.round(width * l), top: Math.round(height * t), width: Math.round(width * (1 - l - r)), height: Math.round(height * (1 - t - b)) });
    } else {
      img = img.extend({ left: Math.round(-l * width), top: Math.round(-t * height), right: Math.round(-r * width), bottom: Math.round(-b * height), background: "#141210" });
    }
    img = sharp(await img.png().toBuffer());
  }
  if (v.scale && v.scale !== 1) {
    const m = await img.metadata();
    img = sharp(await img.resize(Math.round((m.width ?? width) * v.scale)).png().toBuffer());
  }
  if (v.modulate) img = sharp(await img.modulate({ brightness: v.modulate }).png().toBuffer());
  if (v.gamma) img = sharp(await img.gamma(v.gamma).png().toBuffer());
  return v.jpeg ? img.jpeg({ quality: v.jpeg }).toBuffer() : img.png().toBuffer();
}

const FIELDS = ["name", "hero", "level", "kills", "deaths", "assists", "net_worth", "last_hits", "denies", "gpm", "xpm", "hero_damage", "hero_healing"];
const engine = createNodeEngine();
for (const v of VARIANTS.filter((x) => !ONLY || ONLY.includes(x.name))) {
  const inputs = await Promise.all(originals.map((b) => distort(b, v)));
  const { match, notes } = await parseScreenshots(engine, inputs);
  let right = 0, total = 0;
  for (const k of ["team_a", "team_b", "score_a", "score_b", "winner", "duration"]) {
    total++;
    if (String(match[k]).toLowerCase() === String(expected[k]).toLowerCase()) right++;
  }
  const misses = [];
  expected.players.forEach((w, i) => FIELDS.forEach((f) => {
    total++;
    const g = match.players[i]?.[f];
    if ((typeof g === "string" ? g.toLowerCase() : g) === (typeof w[f] === "string" ? w[f].toLowerCase() : w[f])) right++;
    else misses.push(`${w.name}.${f}=${JSON.stringify(g)}`);
  }));
  if (process.env.SHOW === v.name) console.log(misses.join("  "));
  const problems = notes.filter((n) => !n.startsWith("Row")).join(" / ");
  console.log(`${v.name.padEnd(26)} ${String(right).padStart(3)}/${total} (${Math.round((right / total) * 100)}%)${problems ? "  NOTE: " + problems : ""}`);
}
await engine.terminate();
