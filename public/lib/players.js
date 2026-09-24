// Match OCR'd player names to names we already know: the AD2L Champion rosters and the
// names on earlier scrim uploads. Close misreads ("Icarus<", "Frogqer") are fixed
// automatically; looser resemblances ("Daddy Kaleb" ~ "Kaleb") are only suggested,
// because an in-game name can differ from a roster name on purpose.
import { levenshtein } from "./heroes.js";

// Comparison key: case, spaces and punctuation don't count ("Dr. Spike" = "drspike").
export const nameKey = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// Known names from the AD2L data file and saved scrims. One entry per distinct spelling.
export function buildPlayerIndex(ad2l, scrimMatches = []) {
  const map = new Map();
  const add = (name, team, source) => {
    const key = nameKey(name);
    if (key.length < 2) return;
    const e = map.get(name) ?? { name, key, teams: new Set(), sources: new Set() };
    if (team) e.teams.add(team);
    e.sources.add(source);
    map.set(name, e);
  };
  for (const t of ad2l?.teams ?? []) for (const p of t.players) add(p.name, t.name, "ad2l");
  // Stand-ins aren't on a roster but do appear in the division's games.
  for (const g of ad2l?.games ?? []) for (const p of g.players) if (!/^account \d+$|^anonymous$/.test(p.name)) add(p.name, p.team_name, "ad2l");
  const league = [...map.values()];
  // A saved scrim name that's a near-copy of a league name ("Icarus<", "MERCURY") is an
  // old misread, not a different player: don't let it vouch for itself.
  for (const m of scrimMatches) for (const p of m.players ?? []) {
    const key = nameKey(p.name);
    if (!map.has(p.name) && league.some((e) => closeness(key, e.key) != null && closeness(key, e.key) <= 1)) continue;
    add(p.name, null, "scrim");
  }
  return [...map.values()];
}

const commonPrefix = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

// How close `key` is to a known key: 0 same, 1 sure misread, 2 loose resemblance, null none.
function closeness(key, known) {
  if (key === known) return 0;
  const n = Math.min(key.length, known.length);
  const d = levenshtein(key, known);
  if (n >= 4 && d <= (n >= 10 ? 2 : 1)) return 1;
  if (n >= 4 && (key.includes(known) || known.includes(key))) return 2;
  if (commonPrefix(key, known) >= 6) return 2;
  if (n >= 6 && d <= 3) return 2;
  return null;
}

// For each player in a parsed match: { i, from, to, sure, teams } when a known name fits
// better than what was read. Players whose name is already known exactly are left alone.
export function matchPlayers(players, index) {
  if (!index.length) return [];
  const found = players.map((p, i) => {
    const key = nameKey(p.name);
    if (key.length < 2) return null;
    if (index.some((e) => e.name === p.name)) return { i, exact: true, teams: index.find((e) => e.name === p.name).teams };
    let best = null;
    for (const e of index) {
      const c = closeness(key, e.key);
      if (c == null) continue;
      const d = levenshtein(key, e.key);
      if (!best || c < best.c || (c === best.c && d < best.d)) best = { c, d, list: [e] };
      else if (c === best.c && d === best.d && !best.list.some((x) => x.name === e.name)) best.list.push(e);
    }
    return best ? { i, best } : null;
  });

  // Team hint: which AD2L teams the confidently-known players on each side belong to.
  const sideTeams = { a: new Map(), b: new Map() };
  for (const f of found) {
    const teams = f?.exact ? f.teams : f?.best.c <= 1 && f.best.list.length === 1 ? f.best.list[0].teams : null;
    for (const t of teams ?? []) { const s = sideTeams[players[f.i].team]; s?.set(t, (s.get(t) ?? 0) + 1); }
  }

  const out = [];
  for (const f of found) {
    if (!f || f.exact) continue;
    let list = f.best.list;
    if (list.length > 1) {
      const hint = sideTeams[players[f.i].team] ?? new Map();
      const score = (e) => Math.max(0, ...[...e.teams].map((t) => hint.get(t) ?? 0));
      const top = Math.max(...list.map(score));
      list = list.filter((e) => score(e) === top);
    }
    const names = [...new Set(list.map((e) => e.name))];
    if (names.length !== 1) continue; // ambiguous: leave it to the person reviewing
    const e = list[0];
    if (e.name === players[f.i].name) continue;
    out.push({ i: f.i, from: players[f.i].name, to: e.name, sure: f.best.c <= 1, teams: [...e.teams] });
  }
  return out;
}
