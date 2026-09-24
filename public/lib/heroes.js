import RAW from "./heroes-data.js";

// The in-game scoreboard sometimes spells names differently from dotaconstants.
const DISPLAY_OVERRIDES = { "Ring Master": "Ringmaster" };

export const HEROES = RAW.map((n) => DISPLAY_OVERRIDES[n] ?? n).sort();

const key = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const byKey = new Map(HEROES.map((n) => [key(n), n]));

// Exact match ignoring case/spacing/punctuation, or null.
export function canonicalHero(name) {
  return byKey.get(key(name)) ?? null;
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// OCR text → closest real hero, if within ~30% edits of its length.
export function matchHero(raw) {
  const exact = canonicalHero(raw);
  if (exact) return exact;
  const r = key(raw);
  if (r.length < 3) return null;
  let best = null, bestD = Infinity;
  for (const h of HEROES) {
    const d = levenshtein(r, key(h));
    if (d < bestD) { best = h; bestD = d; }
  }
  return bestD <= Math.max(1, Math.floor(key(best).length * 0.3)) ? best : null;
}
