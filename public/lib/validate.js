import { canonicalHero } from "./heroes.js";

export const STAT_FIELDS = [
  "level", "kills", "deaths", "assists", "net_worth",
  "last_hits", "denies", "gpm", "xpm", "hero_damage", "hero_healing",
];

export function parseDuration(s) {
  const m = /^(?:(\d+):)?(\d{1,3}):(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// Errors block saving. Warnings are shown but don't block: team score can legitimately
// differ from summed player kills (tower/creep/neutral kills count toward score).
// Limits here are at least as strict as firebase/scrimleague.rules, so anything the form
// accepts, the database accepts.
export function validateMatch(m) {
  const errors = [];
  const warnings = [];

  for (const t of ["a", "b"]) {
    const name = m[`team_${t}`]?.trim();
    if (!name) errors.push(`Team ${t.toUpperCase()} name is missing.`);
    else if (name.length > 40) errors.push(`Team ${t.toUpperCase()} name is over 40 characters.`);
    const score = m[`score_${t}`];
    if (!Number.isInteger(score) || score < 0 || score > 200) errors.push(`Team ${t.toUpperCase()} score must be a whole number from 0 to 200.`);
  }
  if (m.team_a?.trim() && m.team_a.trim().toLowerCase() === m.team_b?.trim().toLowerCase()) errors.push("Both teams have the same name.");
  if (!["a", "b"].includes(m.winner)) errors.push("Pick a winner.");
  const secs = parseDuration(m.duration);
  if (secs == null) errors.push(`Duration "${m.duration ?? ""}" isn't mm:ss.`);
  else if (secs < 120 || secs > 14400) errors.push("Duration must be between 2:00 and 4:00:00.");
  if ((m.game_mode ?? "").trim().length > 40) errors.push("Game mode is over 40 characters.");

  const players = Array.isArray(m.players) ? m.players : [];
  const seenHeroes = new Set();
  if (players.length !== 10 || players.some((p, i) => p.team !== (i < 5 ? "a" : "b"))) {
    errors.push("Expected 10 players: five on team A, then five on team B.");
  }

  players.forEach((p, i) => {
    const who = p.name?.trim() || `Row ${i + 1}`;
    if (!p.name?.trim()) errors.push(`Row ${i + 1}: player name is missing.`);
    else if (p.name.trim().length > 32) errors.push(`${who}: name is over 32 characters.`);
    if ((p.tag ?? "").trim().length > 16) errors.push(`${who}: tag is over 16 characters.`);
    const hero = canonicalHero(p.hero);
    if (!hero) errors.push(`${who}: "${p.hero ?? ""}" isn't a known hero.`);
    else if (seenHeroes.has(hero)) errors.push(`${who}: ${hero} appears twice.`);
    else seenHeroes.add(hero);
    for (const f of STAT_FIELDS) {
      if (!Number.isInteger(p[f]) || p[f] < 0) errors.push(`${who}: ${f.replace("_", " ")} is missing or invalid.`);
    }
    if (Number.isInteger(p.level) && (p.level < 1 || p.level > 30)) errors.push(`${who}: level must be 1–30.`);
    const total = STAT_FIELDS.reduce((s, f) => s + (Number.isInteger(p[f]) ? p[f] : 0), 0);
    if (total > 2000000) errors.push(`${who}: stats are implausibly large — check for a misread.`);
  });

  if (errors.length === 0) {
    for (const [t, o] of [["a", "b"], ["b", "a"]]) {
      const team = players.filter((p) => p.team === t);
      const kills = team.reduce((s, p) => s + p.kills, 0);
      const enemyDeaths = players.filter((p) => p.team === o).reduce((s, p) => s + p.deaths, 0);
      const T = t.toUpperCase();
      if (kills > m[`score_${t}`]) warnings.push(`Team ${T} players have ${kills} kills but the score is ${m[`score_${t}`]}. Kills can't exceed score — check for a misread.`);
      else if (kills < m[`score_${t}`]) warnings.push(`Team ${T} players have ${kills} kills vs score ${m[`score_${t}`]}. Fine if some kills were by towers/creeps; otherwise check.`);
      if (enemyDeaths !== m[`score_${t}`]) warnings.push(`Team ${T} score is ${m[`score_${t}`]} but the other team has ${enemyDeaths} deaths.`);
    }
    const w = m.winner === "a" ? "a" : "b";
    const l = w === "a" ? "b" : "a";
    if (m[`score_${w}`] < m[`score_${l}`]) warnings.push("The winner has the lower score. Possible, but double-check the winner.");
  }

  // Normalize hero spelling so the saved data is consistent.
  const normalized = {
    ...m,
    team_a: m.team_a?.trim(),
    team_b: m.team_b?.trim(),
    players: players.map((p) => ({ ...p, name: p.name?.trim(), hero: canonicalHero(p.hero) ?? p.hero })),
  };
  return { ok: errors.length === 0, errors, warnings, match: normalized };
}
