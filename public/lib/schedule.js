// Strength of schedule from series results (the same idea as RPI in college sports):
//   OWP  — opponents' game win %, leaving out their games against this team (so beating
//          someone doesn't make your own schedule look weaker);
//   OOWP — those opponents' own OWP (how tough *their* opponents were);
//   SOS  — (2·OWP + OOWP) / 3.
// Each series counts once, so meeting a team twice weights them twice. Game win % is used
// rather than series results because AD2L series are best-of-2 and ties are common.
// Series: { home, away, home_score, away_score } with team ids; unplayed = null scores.

export const isPlayed = (s) => s.home_score != null && s.away_score != null && s.home_score + s.away_score > 0;

function gamesOf(played, team, skipOpp = null) {
  let w = 0, l = 0;
  for (const s of played) {
    if (s.home !== team && s.away !== team) continue;
    const opp = s.home === team ? s.away : s.home;
    if (opp === skipOpp) continue;
    w += s.home === team ? s.home_score : s.away_score;
    l += s.home === team ? s.away_score : s.home_score;
  }
  return { w, l };
}
const rate = ({ w, l }) => (w + l ? w / (w + l) : null);
const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export function strengthOfSchedule(teamIds, series) {
  const played = series.filter(isPlayed).sort((a, b) => (a.time ?? 0) - (b.time ?? 0)); // oldest first
  const remaining = series.filter((s) => !isPlayed(s) && s.home != null && s.away != null);
  const oppsOf = (t) => played.filter((s) => s.home === t || s.away === t).map((s) => ({ s, opp: s.home === t ? s.away : s.home }));

  const owp = new Map(teamIds.map((t) => [t, mean(oppsOf(t).map(({ opp }) => rate(gamesOf(played, opp, t))))]));
  return teamIds.map((t) => {
    const faced = oppsOf(t).map(({ s, opp }) => {
      const us = s.home === t ? s.home_score : s.away_score, them = s.home === t ? s.away_score : s.home_score;
      return { opp, us, them, result: us > them ? "w" : us < them ? "l" : "t", opp_rate: rate(gamesOf(played, opp, t)) };
    });
    const oowp = mean(faced.map((f) => owp.get(f.opp)));
    const o = owp.get(t);
    const left = remaining.filter((s) => s.home === t || s.away === t).map((s) => (s.home === t ? s.away : s.home));
    return {
      id: t,
      owp: o,
      oowp,
      sos: o == null ? null : oowp == null ? o : (2 * o + oowp) / 3,
      faced,
      remaining: left,
      remaining_sos: mean(left.map((opp) => rate(gamesOf(played, opp)))),
    };
  });
}
