import { readRegion, readNumberGroups, readName } from "./core.js";
import { matchHero } from "../heroes.js";

// Scoreboard tab. Layout was measured on a 2000x854 screenshot, relative to the "LH"
// column header (x) and each team's "ITEMS" header (y), scaled by the LH→HERO distance.
const REF_SPAN = 584; // HERO.x0 - LH.x0
const REF_PITCH = 63.5; // row height

const norm = (s) => s.toUpperCase().replace(/[^A-Z]/g, "");

export function isScoreboard(words) {
  return words.some((w) => w.conf > 50 && ["GPM", "ITEMS", "BACKPACK"].includes(norm(w.text)));
}

// Column-header words and their x offset from "LH" in the reference screenshot.
const HEADER_X = { ITEMS: -995, BACKPACK: -599, NEUTRAL: -385, CHOICES: -303, BUFFS: -115, LH: 0, GPM: 119, HEAL: 382, HERO: 584 };

// Fit x = lhX + k·ref from whichever header words OCR found. Try every pair, keep the fit
// most other words agree with, so one misread word can't skew it.
function fitColumns(found) {
  let best = null;
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      const [p, q] = [found[i], found[j]];
      if (p.ref === q.ref) continue;
      const k = (q.x - p.x) / (q.ref - p.ref);
      if (k < 0.3 || k > 4) continue;
      const lhX = p.x - k * p.ref;
      const inliers = found.filter((w) => Math.abs(lhX + k * w.ref - w.x) < 8 * k);
      if (!best || inliers.length > best.inliers.length) best = { k, lhX, inliers };
    }
  }
  if (!best) return null;
  // Refine with least squares over the inliers.
  const n = best.inliers.length;
  if (n >= 3) {
    const mr = best.inliers.reduce((s, w) => s + w.ref, 0) / n, mx = best.inliers.reduce((s, w) => s + w.x, 0) / n;
    let sxy = 0, sxx = 0;
    for (const w of best.inliers) { sxy += (w.ref - mr) * (w.x - mx); sxx += (w.ref - mr) ** 2; }
    best.k = sxy / sxx;
    best.lhX = mx - best.k * mr;
  }
  return best;
}

export function findAnchors(words, image) {
  const found = words
    .filter((w) => w.conf > 50 && norm(w.text) in HEADER_X)
    .map((w) => ({ ref: HEADER_X[norm(w.text)], x: w.x0, y: w.y0 }));
  const fit = fitColumns(found);
  if (!fit) return { error: "Couldn't find the scoreboard column headers. Include the full width of the Scoreboard tab." };
  const { k, lhX, inliers } = fit;

  // Header rows: cluster the inlier words by y.
  const rows = [];
  for (const w of [...inliers].sort((a, b) => a.y - b.y)) {
    const row = rows.find((r) => Math.abs(r.y - w.y) < 15 * k);
    if (row) row.ys.push(w.y); else rows.push({ y: w.y, ys: [w.y] });
  }
  const ys = rows.filter((r) => r.ys.length >= 2 || rows.length <= 2)
    .map((r) => r.ys.sort((a, b) => a - b)[Math.floor(r.ys.length / 2)]);

  let headers, pitch;
  if (ys.length >= 2) {
    headers = [ys[0], ys[ys.length - 1]];
    pitch = (headers[1] - headers[0]) / 6;
  } else {
    // One header row: team A's sits near the top of the screenshot, team B's mid-way.
    pitch = REF_PITCH * k;
    headers = ys[0] < image.height * 0.35 ? [ys[0], ys[0] + 6 * pitch] : [ys[0] - 6 * pitch, ys[0]];
  }
  const winner = words.find((w) => norm(w.text) === "WINNER");
  return { k, pitch, lhX, headers, winnerY: winner?.y0 ?? null };
}

const digits = (s) => (/\d/.test(s) ? Number(s.replace(/\D/g, "")) : null);

// Clan tags ("[ABC]") are tiny gray small caps that OCR garbles, so the name is read with
// a threshold that drops them; anything left from an opening bracket on is cut.
// Trailing tokens with fewer than 3 letters/digits are remnants of the tag ("Some Name = +").
const cleanName = (raw) => {
  const words = raw
    .replace(/^[\[|](?=[a-z])/, "I") // a leading "I" often reads as "[" or "|"
    .replace(/\s+[\[({].*$/, "") // tag after the name
    .trim().split(/\s+/);
  while (words.length > 1 && words[words.length - 1].replace(/[^A-Za-z0-9]/g, "").length < 3) words.pop();
  return words.join(" ");
};
// Hero level is 1–30; the circle around it sometimes reads as an extra digit.
const level = (s) => { const m = s.match(/\d{1,2}/); const n = m ? Number(m[0]) : null; return n >= 1 && n <= 30 ? n : null; };

export async function readScoreboard(engine, image, words) {
  const a = findAnchors(words, image);
  if (a.error) return { error: a.error };
  const { k, pitch, lhX, headers } = a;
  const R = (x0, y0, x1, y1) => ({ x0: lhX + x0 * k, y0, x1: lhX + x1 * k, y1 });
  // Upscale so text ends up the same size whatever the screenshot resolution.
  const scale = Math.max(2, Math.round(3 / k));
  // Each cell is read with its fixed cutoff (best on crisp, true-colour screenshots) and a
  // cutoff relative to the cell's brightest text (survives a browser dimming/brightening
  // colours on decode). Agreement wins outright; otherwise the more confident valid
  // reading; Otsu is the last resort when neither is valid.
  const read = async (rect, opts, valid = (t) => t.length > 0) => {
    const { rel, ...base } = opts;
    const fixed = await readRegion(engine, image, rect, { scale, ...base });
    if (rel == null) return fixed;
    const relative = await readRegion(engine, image, rect, { scale, ...base, threshold: { rel }, name: base.name && `${base.name}_rel` });
    if (fixed.text === relative.text) return fixed;
    let ok = [fixed, relative].filter((r) => valid(r.text));
    if (!ok.length) ok = [await readRegion(engine, image, rect, { scale, ...base, threshold: "otsu", min: 70, name: base.name && `${base.name}_otsu` })].filter((r) => valid(r.text));
    return ok.sort((x, y) => y.conf - x.conf)[0] ?? fixed;
  };
  const isNum = (t) => /^\d[\d,]*$/.test(t.trim());
  const NUM = { whitelist: "0123456789,", threshold: 140, rel: 0.65 };

  const teams = [];
  for (let t = 0; t < 2; t++) {
    const h = headers[t];
    const name = await read(R(-1268, h - 12 * k, -1105, h + 10 * k), { threshold: 120, name: `t${t}_name` });
    const score = await read(R(-1268, h + 8 * k, -1175, h + 30 * k), { threshold: 120, name: `t${t}_score` });
    teams.push({ name: name.text, score: digits(score.text.split(":").pop()) });
  }

  const players = [];
  for (let t = 0; t < 2; t++) {
    for (let j = 1; j <= 5; j++) {
      const cy = headers[t] + j * pitch + 2 * k;
      const n = `${t ? "b" : "a"}${j}`;
      const [ny0, ny1] = [cy - 30 * k, cy - 6 * k];
      const [hy0, hy1] = [cy + 4 * k, cy + 26 * k];
      const [vy0, vy1] = [cy - 14 * k, cy + 16 * k];

      const name = await readName(engine, image, R(-1234, ny0, -1045, ny1), { scale, name: `${n}_name` });
      const hero = await read(R(-1215, hy0, -1040, hy1), { whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ' -", threshold: 110, name: `${n}_hero` }, (t) => matchHero(t) != null);
      const lvl = await read(R(-1240, hy0, -1216, hy1), { whitelist: "0123456789", threshold: 140, rel: 0.65, name: `${n}_level` }, (t) => level(t) != null);
      // LH/DN: fixed and relative; if they disagree, the relative one (colour-proof) wins
      // when it's complete. Otsu if neither parses.
      const lhdnRect = R(-14, vy0, 106, vy1);
      const complete = (g) => g.length === 2 && !g.includes(null);
      const lhFixed = await readNumberGroups(engine, image, lhdnRect, { count: 2, scale, threshold: 140, name: `${n}_lhdn` });
      const lhRel = await readNumberGroups(engine, image, lhdnRect, { count: 2, scale, threshold: { rel: 0.65 }, name: `${n}_lhdn_rel` });
      let lhdn = complete(lhRel) ? lhRel : lhFixed;
      if (!complete(lhdn)) {
        lhdn = await readNumberGroups(engine, image, lhdnRect, { count: 2, scale, threshold: "otsu", min: 84, name: `${n}_lhdn_otsu` });
      }
      const gpm = await read(R(118, vy0, 186, vy1), { ...NUM, threshold: 110, rel: 0.52, name: `${n}_gpm` }, isNum);
      const xpm = await read(R(280, vy0, 356, vy1), { ...NUM, name: `${n}_xpm` }, isNum);
      const heal = await read(R(372, vy0, 450, vy1), { ...NUM, name: `${n}_heal` }, isNum);
      const dmg = await read(R(580, vy0, 665, vy1), { ...NUM, name: `${n}_dmg` }, isNum);

      players.push({
        name: cleanName(name.text),
        tag: null,
        heroRaw: hero.text,
        level: level(lvl.text),
        last_hits: lhdn[0] ?? null, denies: lhdn[1] ?? null,
        gpm: digits(gpm.text), xpm: digits(xpm.text),
        hero_healing: digits(heal.text), hero_damage: digits(dmg.text),
      });
    }
  }

  let winner = null;
  if (a.winnerY != null) winner = Math.abs(a.winnerY - headers[0]) < Math.abs(a.winnerY - headers[1]) ? "a" : "b";
  return { team_a: teams[0].name, team_b: teams[1].name, score_a: teams[0].score, score_b: teams[1].score, winner, players };
}
