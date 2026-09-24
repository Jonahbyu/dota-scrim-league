import { loadImage, findWords } from "./core.js";
import { readOverview } from "./overview.js";
import { readScoreboard, isScoreboard } from "./scoreboard.js";
import { matchHero } from "../heroes.js";

// Parse 1–2 post-game screenshots into a draft match (the review form's shape) plus
// notes about anything that couldn't be read. `inputs` are whatever engine.decode accepts.
export async function parseScreenshots(engine, inputs, { onProgress } = {}) {
  let overview = null, scoreboard = null;
  const notes = [];

  for (const [i, input] of inputs.entries()) {
    onProgress?.(`Reading screenshot ${i + 1} of ${inputs.length}…`);
    const image = await loadImage(engine, input);
    const words = await findWords(engine, image);
    if (isScoreboard(words)) {
      if (scoreboard) { notes.push(`Screenshot ${i + 1} is a second Scoreboard tab — ignored.`); continue; }
      const r = await readScoreboard(engine, image, words);
      if (r.error) notes.push(`Screenshot ${i + 1}: ${r.error}`); else scoreboard = r;
    } else {
      if (overview) { notes.push(`Screenshot ${i + 1} looks like a second overview — ignored.`); continue; }
      const r = await readOverview(engine, image);
      if (r.error) notes.push(`Screenshot ${i + 1}: ${r.error} Use the post-game overview (hero cards) or the Scoreboard tab.`);
      else overview = r;
    }
  }
  if (!overview) notes.push("Missing the overview screenshot: K/D/A, net worth, score and duration need filling in.");
  if (!scoreboard) notes.push("Missing the Scoreboard tab screenshot: names, heroes, LH/DN, GPM/XPM, heal and hero damage need filling in.");

  // Line overview cards up with scoreboard rows, per team: a scoreboard name found in exactly
  // one card's (noisy) name text pins that card; unpinned cards keep their order.
  const key = (t) => (t ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const order = [...Array(10).keys()];
  if (overview && scoreboard) for (const base of [0, 5]) {
    const cards = [0, 1, 2, 3, 4].map((j) => key(overview.players[base + j]?.nameRaw));
    const slot = [0, 1, 2, 3, 4].map((j) => {
      const n = key(scoreboard.players[base + j]?.name);
      const hits = n.length >= 3 ? cards.flatMap((c, ci) => (c.includes(n) ? [ci] : [])) : [];
      return hits.length === 1 ? hits[0] : null;
    });
    if (new Set(slot.filter((x) => x != null)).size !== slot.filter((x) => x != null).length) continue;
    const free = [0, 1, 2, 3, 4].filter((ci) => !slot.includes(ci));
    slot.forEach((ci, j) => { order[base + j] = base + (ci ?? free.shift()); });
  }

  const pick = (...vals) => vals.find((v) => v != null && v !== "") ?? null;
  const players = [];
  for (let i = 0; i < 10; i++) {
    const s = scoreboard?.players[i] ?? {};
    const o = overview?.players[order[i]] ?? {};
    const hero = s.heroRaw ? matchHero(s.heroRaw) : null;
    if (s.heroRaw && !hero) notes.push(`Row ${i + 1}: couldn't match hero text "${s.heroRaw}".`);
    players.push({
      team: i < 5 ? "a" : "b",
      name: s.name ?? "",
      tag: s.tag ?? null,
      hero: hero ?? "",
      level: s.level ?? null,
      kills: o.kda?.[0] ?? null, deaths: o.kda?.[1] ?? null, assists: o.kda?.[2] ?? null,
      net_worth: o.net_worth ?? null,
      last_hits: s.last_hits ?? null, denies: s.denies ?? null,
      gpm: s.gpm ?? null, xpm: s.xpm ?? null,
      hero_damage: s.hero_damage ?? null, hero_healing: s.hero_healing ?? null,
      pick: s.pick ?? null,
    });
  }

  const match = {
    team_a: pick(scoreboard?.team_a, overview?.team_a) ?? "",
    team_b: pick(scoreboard?.team_b, overview?.team_b) ?? "",
    score_a: pick(overview?.score_a, scoreboard?.score_a),
    score_b: pick(overview?.score_b, scoreboard?.score_b),
    winner: pick(overview?.winner, scoreboard?.winner),
    duration: overview?.duration ?? "",
    game_mode: overview?.game_mode ?? "",
    players,
  };
  return { match, notes };
}
