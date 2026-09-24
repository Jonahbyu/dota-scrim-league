// Unticketed AD2L games: division games played without a league ticket, so they never
// reach OpenDota's league list. They're uploaded from screenshots like scrims and stored in
// Firestore (scrimLeague/data/ad2l_unticketed), then merged into the AD2L view here.
import { nameKey } from "./players.js";

export const teamByName = (d, n) => d?.teams.find((t) => nameKey(t.name) === nameKey(n ?? "")) ?? null;

// An uploaded game in the AD2L shape: team ids from the division list, and each player
// matched to a roster account by name (roster names, plus names seen in ticketed games), so
// the game counts for the same person as their ticketed games.
export function asAd2l(u, d) {
  const acct = new Map();
  for (const g of d.games) for (const p of g.players) if (p.account_id) acct.set(nameKey(p.name), { name: p.name, account_id: p.account_id, rank_tier: p.rank_tier });
  for (const t of d.teams) for (const p of t.players) acct.set(nameKey(p.name), { name: p.name, account_id: p.account_id, rank_tier: p.rank_tier });
  const home = new Map(d.teams.flatMap((t) => t.players.map((p) => [String(p.account_id), t.id])));
  const ta = teamByName(d, u.team_a), tb = teamByName(d, u.team_b);
  return {
    ...u, unticketed: true,
    team_a: ta?.name ?? u.team_a, team_b: tb?.name ?? u.team_b, team_a_id: ta?.id ?? null, team_b_id: tb?.id ?? null,
    // Same fields ticketed games carry: player_key is what the leaderboards group by, and
    // team_name is what credits the game to a team.
    players: (u.players ?? []).map((p) => {
      const side = p.team === "a" ? ta : tb;
      const k = acct.get(nameKey(p.name));
      if (!k?.account_id) return side ? { ...p, team_name: side.name, standin: true } : p;
      return {
        ...p, name: k.name, account_id: k.account_id, player_key: String(k.account_id), rank_tier: p.rank_tier ?? k.rank_tier ?? null,
        team_name: side?.name ?? null, standin: home.get(String(k.account_id)) !== side?.id,
      };
    }),
  };
}

// Games PlayOn scored but nobody has on record: a series scored 2-0 with one ticketed
// game and no upload for it is missing one game. Each is { series, game } (game = its
// number in the series, after the ones on record); these are what an upload can fill.
export function missingGames(d, uploads = []) {
  const out = [];
  for (const s of d.series) {
    const played = (s.home_score ?? 0) + (s.away_score ?? 0);
    const have = d.games.filter((g) => g.series_id === s.id).length + uploads.filter((u) => u.series_id === s.id).length;
    for (let game = have + 1; game <= played; game++) out.push({ series: s, game });
  }
  return out;
}

// Every game an unticketed upload can stand for: games missing from series PlayOn has
// scored (earlier weeks), plus both games of series not scored yet that are scheduled
// before `until` (this week's, not ticketed yet). Each is { series, game, scored }.
// `except` is an upload being moved, so its own slot counts as open.
export function openGames(d, uploads = [], until = Infinity, except = null) {
  const out = [];
  for (const s of d.series) {
    const played = (s.home_score ?? 0) + (s.away_score ?? 0);
    const scored = played > 0;
    const total = scored ? played : s.time && s.time <= until ? 2 : 0;
    const have = d.games.filter((g) => g.series_id === s.id).length + uploads.filter((u) => u.series_id === s.id && u.id !== except).length;
    for (let game = have + 1; game <= total; game++) out.push({ series: s, game, scored });
  }
  return out.sort((a, b) => (b.series.time ?? 0) - (a.series.time ?? 0));
}

// Do the draft's two team names match this series' two teams (either way round)?
export function sameTeams(d, s, a, b) {
  const ids = [teamByName(d, a)?.id, teamByName(d, b)?.id];
  return ids.includes(s.home) && ids.includes(s.away) && s.home !== s.away;
}

// If a side's name wasn't read as a division team, use the team most of that side's
// recognised players are rostered on (3+ of 5). Changes `match` in place; returns notes.
export function guessTeams(match, d) {
  const rosterTeam = new Map(d.teams.flatMap((t) => t.players.map((p) => [nameKey(p.name), t])));
  const notes = [];
  for (const side of ["a", "b"]) {
    const key = side === "a" ? "team_a" : "team_b";
    const named = teamByName(d, match[key]);
    if (named) { match[key] = named.name; continue; }
    const counts = new Map();
    for (const p of match.players.filter((q) => q.team === side)) {
      const t = rosterTeam.get(nameKey(p.name));
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const [t, n] = [...counts].sort((x, y) => y[1] - x[1])[0] ?? [];
    if (t && n >= 3) { notes.push(`Team ${side.toUpperCase()} set to ${t.name}: ${n} of its players are on that roster (read “${match[key] || "nothing"}”).`); match[key] = t.name; }
  }
  return notes;
}
