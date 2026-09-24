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
  for (const g of d.games) for (const p of g.players) if (p.account_id) acct.set(nameKey(p.name), { name: p.name, account_id: p.account_id });
  for (const t of d.teams) for (const p of t.players) acct.set(nameKey(p.name), { name: p.name, account_id: p.account_id });
  const home = new Map(d.teams.flatMap((t) => t.players.map((p) => [String(p.account_id), t.id])));
  const ta = teamByName(d, u.team_a), tb = teamByName(d, u.team_b);
  return {
    ...u, unticketed: true,
    team_a: ta?.name ?? u.team_a, team_b: tb?.name ?? u.team_b, team_a_id: ta?.id ?? null, team_b_id: tb?.id ?? null,
    players: (u.players ?? []).map((p) => {
      const k = acct.get(nameKey(p.name));
      if (!k?.account_id) return p;
      const teamId = p.team === "a" ? ta?.id : tb?.id;
      return { ...p, name: k.name, account_id: k.account_id, standin: home.get(String(k.account_id)) !== teamId };
    }),
  };
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
