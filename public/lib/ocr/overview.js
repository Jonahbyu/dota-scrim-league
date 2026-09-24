import { readRegion, readNumberGroups, columnProfile, rowProfile, runs } from "./core.js";

// Post-game overview screen (10 hero cards). Layout was measured on a 1989x839 screenshot
// and is expressed relative to the detected cards, scaled by card pitch, so different
// crops and resolutions line up.
const REF_PITCH = 170.75;

export function findCards(image) {
  const { width, height } = image;
  const band = columnProfile(image, Math.round(height * 0.3), Math.round(height * 0.7));
  let cards = runs(band, 35, Math.round(width * 0.04));
  if (cards.length !== 10) return { error: `Found ${cards.length} hero cards instead of 10.` };

  // Vertical extent: longest bright run in the first card's columns.
  const rows = rowProfile(image, cards[0][0], cards[0][1]);
  const vr = runs(rows, 10, 20).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
  cards = cards.map(([x0, x1]) => ({ x0, x1 }));
  const pitch = (cards[4].x0 - cards[0].x0) / 4;
  return { cards, top: vr[0], k: pitch / REF_PITCH, mid: (cards[4].x1 + cards[5].x0) / 2 };
}

const toInt = (s) => (/\d/.test(s) ? Number(s.replace(/\D/g, "")) : null);
// Net worth is "12,345" or "9,876"; ignore stray marks (the gold coin) before it.
const toNetWorth = (s) => { const m = s.match(/(\d{1,2},\d{3})$/); return m ? Number(m[1].replace(",", "")) : null; };

export async function readOverview(engine, image) {
  const geo = findCards(image);
  if (geo.error) return { error: geo.error };
  const { cards, top, k, mid } = geo;
  const R = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
  // Upscale so text ends up the same size whatever the screenshot resolution.
  const scale = Math.max(2, Math.round(3 / k));
  const read = (rect, opts) => readRegion(engine, image, rect, { scale, ...opts });

  const mode = await read(R(mid - 150 * k, top - 142 * k, mid + 150 * k, top - 116 * k), { name: "mode" });
  const duration = await read(R(mid - 70 * k, top - 84 * k, mid + 70 * k, top - 44 * k), { whitelist: "0123456789:", name: "duration" });
  const scoreA = await read(R(mid - 215 * k, top - 118 * k, mid - 95 * k, top - 28 * k), { whitelist: "0123456789", name: "score_a" });
  const scoreB = await read(R(mid + 80 * k, top - 118 * k, mid + 200 * k, top - 28 * k), { whitelist: "0123456789", name: "score_b" });
  const teamA = await read(R(cards[0].x0 + 75 * k, top - 106 * k, mid - 218 * k, top - 48 * k), { name: "team_a" });
  const teamB = await read(R(mid + 245 * k, top - 106 * k, cards[9].x1 - 85 * k, top - 48 * k), { name: "team_b" });

  const players = [];
  for (let i = 0; i < 10; i++) {
    const c = cards[i];
    const nw = await read(R(c.x0 + 62 * k, top + 467 * k, c.x1 - 4 * k, top + 494 * k), { whitelist: "0123456789,", threshold: 110, speckle: 0.002, name: `p${i}_nw` });
    const kda = await readNumberGroups(engine, image, R(c.x0 + 10 * k, top + 496 * k, c.x1 - 10 * k, top + 528 * k), { count: 3, scale, threshold: 150, name: `p${i}_kda` });
    players.push({ net_worth: toNetWorth(nw.text), kda: kda.length === 3 ? kda : null });
  }

  // "Victory" is appended to the winning team's name.
  const clean = (s) => s.replace(/\s*victory\s*$/i, "").trim();
  const winner = /victory/i.test(teamA.text) ? "a" : /victory/i.test(teamB.text) ? "b" : null;
  const dur = duration.text.replace(/[^\d:]/g, "");

  return {
    team_a: clean(teamA.text),
    team_b: clean(teamB.text),
    score_a: toInt(scoreA.text),
    score_b: toInt(scoreB.text),
    winner,
    duration: /^\d{1,3}:\d{2}$/.test(dur) ? dur : null,
    game_mode: mode.text.replace(/[^A-Za-z ]/g, "").trim().replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()) || null,
    players,
  };
}
