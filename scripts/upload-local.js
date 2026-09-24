// Upload a game from local screenshots, using the same OCR, validation and stored
// shape as the website. Signs in anonymously like a site visitor.
// Usage: node scripts/upload-local.js <overview.png> <scoreboard.png> [--dry-run]
import { readFile } from "node:fs/promises";
import { createNodeEngine } from "../lib/ocr-node.js";
import { parseScreenshots } from "../public/lib/ocr/parse.js";
import { validateMatch } from "../public/lib/validate.js";
import { matchId } from "../public/lib/stats.js";
import { FIREBASE_CONFIG } from "../public/firebase-config.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const files = args.filter((a) => !a.startsWith("--"));
if (files.length < 1 || files.length > 2) throw new Error("usage: node scripts/upload-local.js <img1> [img2] [--dry-run]");

const engine = createNodeEngine();
const { match, notes } = await parseScreenshots(engine, await Promise.all(files.map((f) => readFile(f))));
await engine.terminate();

const check = validateMatch(match);
console.log(`${match.team_a} ${match.score_a} – ${match.score_b} ${match.team_b}  (${match.duration}, winner ${match.winner})`);
for (const p of check.match.players) console.log(`  ${p.team} ${p.name.padEnd(18)} ${p.hero.padEnd(16)} ${p.kills}/${p.deaths}/${p.assists}  nw ${p.net_worth}  gpm ${p.gpm}  dmg ${p.hero_damage}`);
for (const n of notes) console.log("note:", n);
for (const w of check.warnings) console.log("warning:", w);
if (!check.ok) { for (const e of check.errors) console.log("ERROR:", e); process.exit(1); }
if (dry) { console.log("dry run: not saved"); process.exit(0); }

// Same stored shape as public/lib/store.js toStored().
const m = check.match;
const [mm, ss] = m.duration.split(":").map(Number);
const data = {
  v: 1, team_a: m.team_a, team_b: m.team_b, score_a: m.score_a, score_b: m.score_b, winner: m.winner,
  duration_sec: mm * 60 + ss, game_mode: (m.game_mode ?? "").trim(),
  players: m.players.map((p) => ({ team: p.team, name: p.name, tag: p.tag || null, hero: p.hero,
    level: p.level, kills: p.kills, deaths: p.deaths, assists: p.assists, net_worth: p.net_worth,
    last_hits: p.last_hits, denies: p.denies, gpm: p.gpm, xpm: p.xpm, hero_damage: p.hero_damage, hero_healing: p.hero_healing })),
};
const id = await matchId(data);

// The browser key only accepts requests from our sites (HTTP referrer restriction).
const auth = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_CONFIG.apiKey}`, {
  method: "POST", headers: { "content-type": "application/json", referer: "http://localhost:3000/" }, body: JSON.stringify({ returnSecureToken: true }),
})).json();
const val = (v) => v === null ? { nullValue: null } : typeof v === "string" ? { stringValue: v }
  : Number.isInteger(v) ? { integerValue: String(v) } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const docs = `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const res = await fetch(`https://firestore.googleapis.com/v1/${docs}:commit`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${auth.idToken}` },
  body: JSON.stringify({ writes: [{
    update: { name: `${docs}/scrimLeague/data/matches/${id}`, fields: Object.fromEntries(Object.entries({ ...data, uid: auth.localId }).map(([k, v]) => [k, val(v)])) },
    updateTransforms: [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }],
    currentDocument: { exists: false },
  }] }),
});
if (!res.ok) { console.log("save failed:", res.status, (await res.text()).slice(0, 300)); process.exit(1); }
console.log(`saved: https://jonahbyu.github.io/dota-scrim-league/#/match/${id}`);
