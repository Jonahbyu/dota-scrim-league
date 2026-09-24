// Draft-order analysis for Captains Mode drafts (AD2L). A draft alternates runs of bans and
// picks; the n-th run of bans is ban phase n and the n-th run of picks is pick phase n. S48
// (patch 7.3x) runs: 7 bans, 2 picks, 3 bans, 6 picks, 4 bans, 2 picks. Phases are read from
// each draft rather than hard-coded, so a patch that changes the order still reads right.

// Each step with { phase, kind: "ban" | "pick", team_pick (1-5, picks only) }.
export function phasedDraft(draft) {
  if (!draft?.length) return [];
  const steps = [...draft].sort((a, b) => a.order - b.order);
  const runs = { ban: 0, pick: 0 }, teamPicks = { a: 0, b: 0 };
  let prev = null;
  return steps.map((s) => {
    const kind = s.pick ? "pick" : "ban";
    if (kind !== prev) runs[kind]++;
    prev = kind;
    return { ...s, kind, phase: runs[kind], team_pick: s.pick ? ++teamPicks[s.side] : null };
  });
}

export const PHASES = [1, 2, 3];
const zero = () => [0, 0, 0];

// Per hero across all drafted games: bans and picks in each phase, wins per pick phase,
// plus which side won more often when it held first pick.
export function draftAnalysis(matches) {
  const drafted = matches.filter((m) => m.draft?.length);
  const rows = new Map();
  const row = (hero) => rows.get(hero) ?? rows.set(hero, { hero, bans: zero(), picks: zero(), pick_wins: zero(), last_picks: 0, last_pick_wins: 0 }).get(hero);
  let fp = 0, fpWins = 0;
  for (const m of drafted) {
    const steps = phasedDraft(m.draft);
    const first = steps.find((s) => s.kind === "pick");
    if (first && m.winner) { fp++; if (m.winner === first.side) fpWins++; }
    for (const s of steps) {
      const r = row(s.hero), i = Math.min(s.phase, 3) - 1;
      if (s.kind === "ban") { r.bans[i]++; continue; }
      r.picks[i]++;
      const won = m.winner === s.side;
      if (won) r.pick_wins[i]++;
      if (s.team_pick === 5) { r.last_picks++; if (won) r.last_pick_wins++; }
    }
  }
  const n = drafted.length;
  return {
    games: n,
    first_pick: { games: fp, wins: fpWins, win_rate: fp ? fpWins / fp : null },
    heroes: [...rows.values()].map((r) => {
      const bans = r.bans.reduce((a, b) => a + b, 0), picks = r.picks.reduce((a, b) => a + b, 0);
      return {
        ...r,
        ban_total: bans, pick_total: picks, contested: bans + picks,
        contest_rate: n ? (bans + picks) / n : null,
        pick_win_rate: r.picks.map((p, i) => (p ? r.pick_wins[i] / p : null)),
        win_rate: picks ? r.pick_wins.reduce((a, b) => a + b, 0) / picks : null,
        // Share of its bans that came in the first phase: high = teams remove it on sight.
        p1_ban_share: bans ? r.bans[0] / bans : null,
      };
    }),
  };
}

// A team's bans by phase (theirs and against them) and its picks by phase.
// games: [{ m, side }]
export function teamDraftPhases(games) {
  const mk = () => PHASES.map(() => new Map());
  const bans = mk(), against = mk(), picks = mk();
  let drafted = 0;
  for (const { m, side } of games) {
    if (!m.draft?.length) continue;
    drafted++;
    for (const s of phasedDraft(m.draft)) {
      const i = Math.min(s.phase, 3) - 1;
      const target = s.kind === "ban" ? (s.side === side ? bans : against) : s.side === side ? picks : null;
      if (!target) continue;
      const e = target[i].get(s.hero) ?? { hero: s.hero, n: 0, wins: 0 };
      e.n++;
      if (m.winner === side) e.wins++;
      target[i].set(s.hero, e);
    }
  }
  const top = (maps) => maps.map((mp) => [...mp.values()].sort((a, b) => b.n - a.n || a.hero.localeCompare(b.hero)));
  return drafted ? { drafted, bans: top(bans), against: top(against), picks: top(picks) } : null;
}
