// AD2L predictions: series odds, a model track record, and a draft read per series.
//
// Series odds. Each team gets a strength rating fitted to every game result so far (PlayOn
// series scores, so games OpenDota never saw still count), Bradley-Terry style: the chance
// team i beats team j in one game is 1 / (1 + e^(r_j - r_i)). Early on four weeks of results
// can't carry a rating alone, so each rating is pulled toward a starting point set by the
// roster's average PlayOn medal. How hard it's pulled (lambda) and how much medals are worth
// (beta) are picked by replaying the season week by week and keeping the pair that predicted
// the following week best (log loss). A series is two games, treated as independent:
// 2-0 = p², 1-1 = 2p(1-p), 0-2 = (1-p)².

import { phasedDraft } from "./draft.js";

const sig = (x) => 1 / (1 + Math.exp(-x));

// PlayOn / OpenDota rank_tier (11 = Herald 1 … 75 = Divine 5, 80 = Immortal) as a number
// of medal steps.
export const medalSteps = (t) => (t == null ? null : t >= 80 ? 35 : (Math.floor(t / 10) - 1) * 5 + (t % 10));

export const isPlayed = (s) => (s.home_score ?? 0) + (s.away_score ?? 0) > 0;

function medalPrior(teams, beta) {
  const avg = new Map(teams.map((t) => {
    const m = t.players.map((p) => medalSteps(p.rank_tier)).filter((v) => v != null);
    return [t.id, m.length ? m.reduce((a, b) => a + b, 0) / m.length : null];
  }));
  const known = [...avg.values()].filter((v) => v != null);
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  return new Map([...avg].map(([id, v]) => [id, v == null ? 0 : beta * (v - mean)]));
}

// Ratings from the played series in `series` (only those before `before`, a unix time).
export function fitRatings(teams, series, { lambda = 0.5, beta = 0.05, before = Infinity } = {}) {
  const prior = medalPrior(teams, beta);
  const r = new Map([...prior]);
  const results = series.filter((s) => isPlayed(s) && (s.time ?? 0) < before);
  for (let it = 0; it < 600; it++) {
    const g = new Map([...r.keys()].map((id) => [id, -2 * lambda * (r.get(id) - prior.get(id))]));
    for (const s of results) {
      if (!r.has(s.home) || !r.has(s.away)) continue;
      const p = sig(r.get(s.home) - r.get(s.away));
      // home won home_score games and lost away_score games
      const d = s.home_score * (1 - p) - s.away_score * p;
      g.set(s.home, g.get(s.home) + d);
      g.set(s.away, g.get(s.away) - d);
    }
    const step = 1 / (2 * lambda + 4); // small enough to stay stable for any pull strength
    for (const [id, v] of g) r.set(id, r.get(id) + step * v);
  }
  return r;
}

export function seriesOdds(ra, rb) {
  const p = sig(ra - rb);
  return { game: p, home: p * p, tie: 2 * p * (1 - p), away: (1 - p) * (1 - p) };
}
export const outcomeOf = (s) => (s.home_score > s.away_score ? "home" : s.home_score < s.away_score ? "away" : "tie");
export const favourite = (o) => ["home", "tie", "away"].sort((a, b) => o[b] - o[a])[0];

// League nights: distinct series start times, oldest first.
export const nights = (series) => [...new Set(series.map((s) => s.time).filter(Boolean))].sort((a, b) => a - b);

// Replay the season: predict each league night from the nights before it only.
export function backtest(teams, series, params) {
  const out = [];
  for (const t of nights(series)) {
    const r = fitRatings(teams, series, { ...params, before: t });
    for (const s of series.filter((x) => x.time === t && isPlayed(x))) {
      const o = seriesOdds(r.get(s.home) ?? 0, r.get(s.away) ?? 0);
      const actual = outcomeOf(s);
      out.push({ s, odds: o, pick: modelCall(o), actual, correct: modelCall(o) === actual, p_actual: o[actual] });
    }
  }
  return out;
}

// Pick lambda / beta by week-by-week log loss on the games played so far.
export function tune(teams, series) {
  let best = null;
  for (const lambda of [0.5, 1, 2, 5, 10, 20, 50]) for (const beta of [0, 0.05, 0.1, 0.2, 0.3, 0.4]) {
    let loss = 0, n = 0;
    for (const t of nights(series)) {
      const r = fitRatings(teams, series, { lambda, beta, before: t });
      for (const s of series.filter((x) => x.time === t && isPlayed(x))) {
        const p = sig((r.get(s.home) ?? 0) - (r.get(s.away) ?? 0));
        loss -= s.home_score * Math.log(p) + s.away_score * Math.log(1 - p);
        n += s.home_score + s.away_score;
      }
    }
    if (n && (!best || loss / n < best.loss)) best = { lambda, beta, loss: loss / n, games: n };
  }
  return best ?? { lambda: 0.5, beta: 0.05, loss: null, games: 0 };
}

// ---------- draft read ----------

// Recent pubs for one main account since `since` (unix time): flat groups of 7 in the data.
export function pubsSince(d, accountId, since) {
  const flat = d.pubs?.[accountId] ?? [];
  const out = [];
  for (let i = 0; i + 6 < flat.length; i += 7) {
    if (flat[i] < since) continue;
    out.push({ time: flat[i], hero: flat[i + 1], won: flat[i + 2] === 1, kills: flat[i + 3], deaths: flat[i + 4], assists: flat[i + 5], ranked: flat[i + 6] === 1 });
  }
  return out;
}

export function pubSummary(games) {
  if (!games.length) return null;
  const wins = games.filter((g) => g.won).length;
  const k = games.reduce((s, g) => s + g.kills, 0), dth = games.reduce((s, g) => s + g.deaths, 0), a = games.reduce((s, g) => s + g.assists, 0);
  const heroes = new Map();
  for (const g of games) {
    const h = heroes.get(g.hero) ?? { hero: g.hero, games: 0, wins: 0 };
    h.games++; if (g.won) h.wins++;
    heroes.set(g.hero, h);
  }
  return { games: games.length, wins, win_rate: wins / games.length, kda: (k + a) / Math.max(dth, 1), heroes: [...heroes.values()].sort((x, y) => y.games - x.games || y.wins - x.wins) };
}

// What the model expects in one series for team `us` against `them`:
//  - bans: heroes `us` is likely to ban, scored from how often they've banned it, how much
//    the opponents play it (league + recent pubs), and how often the division bans it;
//  - picks: per player, their most likely heroes (league picks count double recent pubs),
//    discounted by how likely the opponents are to ban them.
// Scores are relative, turned into rough chances by spreading each team's 7 bans.
export function draftRead(d, us, them, since) {
  const drafted = d.games.filter((g) => g.draft?.length);
  const sideOf = (g, id) => (g.team_a_id === id ? "a" : g.team_b_id === id ? "b" : null);
  const banRate = (teamId) => {
    const n = drafted.filter((g) => sideOf(g, teamId)).length;
    const c = new Map();
    for (const g of drafted) {
      const side = sideOf(g, teamId);
      if (!side) continue;
      for (const s of g.draft) if (!s.pick && s.side === side) c.set(s.hero, (c.get(s.hero) ?? 0) + 1);
    }
    return { n, rate: (h) => (n ? (c.get(h) ?? 0) / n : 0), count: (h) => c.get(h) ?? 0 };
  };
  const globalBans = new Map();
  for (const g of drafted) for (const s of g.draft) if (!s.pick) globalBans.set(s.hero, (globalBans.get(s.hero) ?? 0) + 1);
  const metaRate = (h) => (drafted.length ? (globalBans.get(h) ?? 0) / (drafted.length * 2) : 0);

  // Comfort per player: league games on a hero ×2, recent pubs ×1.
  const comfortOf = (team) => team.players.map((p) => {
    const league = new Map();
    for (const g of d.games) for (const q of g.players) if (String(q.account_id) === String(p.account_id)) league.set(q.hero, (league.get(q.hero) ?? 0) + 1);
    const pubs = pubsSince(d, p.account_id, since);
    const pub = new Map();
    for (const g of pubs) pub.set(g.hero, (pub.get(g.hero) ?? 0) + 1);
    const heroes = new Set([...league.keys(), ...pub.keys()]);
    const score = new Map([...heroes].map((h) => [h, 2 * (league.get(h) ?? 0) + (pub.get(h) ?? 0)]));
    return { player: p, league, pub, pubs, score, total: [...score.values()].reduce((a, b) => a + b, 0) };
  });

  const ours = comfortOf(us), theirs = comfortOf(them);
  const threat = new Map(); // share of each opponent's comfort, summed over their players
  for (const c of theirs) for (const [h, v] of c.score) if (c.total) threat.set(h, (threat.get(h) ?? 0) + v / c.total);
  const ourBans = banRate(us.id), theirBans = banRate(them.id);

  const banScores = (bans, opp) => {
    const heroes = new Set([...opp.keys(), ...globalBans.keys()]);
    for (const g of drafted) for (const s of g.draft) if (!s.pick) heroes.add(s.hero);
    return [...heroes].map((h) => ({ hero: h, score: 1.2 * bans.rate(h) + 1.0 * (opp.get(h) ?? 0) + 0.6 * metaRate(h), from_bans: bans.count(h), bans_n: bans.n, threat: opp.get(h) ?? 0 }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  };
  const toChance = (list, slots = 7) => {
    const top = list.slice(0, slots * 2);
    const sum = top.reduce((s, x) => s + x.score, 0) || 1;
    return top.map((x) => ({ ...x, chance: Math.min(0.95, (x.score / sum) * slots) }));
  };
  const ourThreat = new Map(); // what we play, from their point of view
  for (const c of ours) for (const [h, v] of c.score) if (c.total) ourThreat.set(h, (ourThreat.get(h) ?? 0) + v / c.total);
  const weBan = toChance(banScores(ourBans, threat));
  const theyBan = toChance(banScores(theirBans, ourThreat));
  const theyBanChance = new Map(theyBan.map((x) => [x.hero, x.chance]));
  const whoPlays = new Map(); // hero -> opponent players who play it
  for (const c of theirs) for (const [h, v] of c.score) if (v) (whoPlays.get(h) ?? whoPlays.set(h, []).get(h)).push({ name: c.player.name, league: c.league.get(h) ?? 0, pub: c.pub.get(h) ?? 0 });

  const picks = ours.map((c) => {
    const avail = [...c.score].map(([h, v]) => ({ hero: h, score: v * (1 - (theyBanChance.get(h) ?? 0)), league: c.league.get(h) ?? 0, pub: c.pub.get(h) ?? 0, ban_risk: theyBanChance.get(h) ?? 0 }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
    const sum = avail.reduce((s, x) => s + x.score, 0) || 1;
    return { player: c.player, pub: pubSummary(c.pubs), heroes: avail.slice(0, 3).map((x) => ({ ...x, chance: x.score / sum })) };
  });
  return { bans: weBan.slice(0, 7).map((x) => ({ ...x, who: whoPlays.get(x.hero) ?? [] })), picks, drafted: ourBans.n };
}

// ---------- prediction standings ----------
// preds: [{ series_id, pick, name, uid, updatedAt: Date }]. A pick counts only if it was
// saved (server time) before its series started. People are grouped by the name they typed
// (case and punctuation ignored); if one name has two picks for a series, the later counts.
const key = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

export function validPicks(preds, series) {
  const start = new Map(series.map((s) => [s.id, (s.time ?? 0) * 1000]));
  const latest = new Map();
  for (const p of preds) {
    const t = p.updatedAt?.getTime?.() ?? 0;
    if (!start.has(p.series_id) || !(t < start.get(p.series_id)) || !key(p.name)) continue;
    const k = `${key(p.name)}|${p.series_id}`;
    if (!latest.has(k) || latest.get(k).t < t) latest.set(k, { ...p, t });
  }
  return [...latest.values()];
}

export function standings(preds, series, model = []) {
  const done = new Map(series.filter(isPlayed).map((s) => [s.id, outcomeOf(s)]));
  const rows = new Map();
  for (const p of validPicks(preds, series)) {
    if (!done.has(p.series_id)) continue;
    const k = key(p.name);
    const r = rows.get(k) ?? { name: p.name, t: 0, picks: 0, points: 0 };
    if (p.t > r.t) { r.name = p.name; r.t = p.t; }
    r.picks++;
    if (done.get(p.series_id) === p.pick) r.points++;
    rows.set(k, r);
  }
  const out = [...rows.values()].map(({ t, ...r }) => ({ ...r, accuracy: r.picks ? r.points / r.picks : null }));
  if (model.length) out.push({ name: "The model", model: true, picks: model.length, points: model.filter((m) => m.correct).length, accuracy: model.filter((m) => m.correct).length / model.length });
  return out.sort((a, b) => b.points - a.points || (b.accuracy ?? 0) - (a.accuracy ?? 0) || a.name.localeCompare(b.name));
}

// Share of (counting) picks per outcome for one series.
export function crowd(preds, s) {
  const mine = validPicks(preds, [{ ...s, time: s.time ?? Infinity }]).filter((p) => p.series_id === s.id);
  const n = mine.length;
  const share = (o) => (n ? mine.filter((p) => p.pick === o).length / n : 0);
  return { n, home: share("home"), tie: share("tie"), away: share("away") };
}

// ---------- the model's call ----------
// The odds stay honest; the call is bold. It takes the favourite to win 2-0 unless the
// teams are a genuine coin flip (per-game odds within 1.5 points of 50%), then it calls 1-1.
// That's roughly one split a week; everything else is a sweep.
export const TIE_EDGE = 0.015;
export const modelCall = (o) => (Math.abs(o.game - 0.5) < TIE_EDGE ? "tie" : o.game >= 0.5 ? "home" : "away");

// ---------- predicted draft ----------
// Captains Mode order as S48 plays it, from the first-pick team's (X) point of view; the
// same in all 38 drafts: X bans 3/2/2 across the phases, Y bans 4/1/2.
export const CM_ORDER = [
  ["X", "ban", 1], ["X", "ban", 1], ["Y", "ban", 1], ["Y", "ban", 1], ["X", "ban", 1], ["Y", "ban", 1], ["Y", "ban", 1],
  ["X", "pick", 1], ["Y", "pick", 1],
  ["X", "ban", 2], ["X", "ban", 2], ["Y", "ban", 2],
  ["Y", "pick", 2], ["X", "pick", 2], ["X", "pick", 2], ["Y", "pick", 2], ["Y", "pick", 2], ["X", "pick", 2],
  ["X", "ban", 3], ["Y", "ban", 3], ["X", "ban", 3], ["Y", "ban", 3],
  ["X", "pick", 3], ["Y", "pick", 3],
];

const HALF_LIFE = 14 * 86400; // league games lose half their weight every two weeks

// Plays a whole draft step by step. Each ban goes to the hero with the best mix of: how
// often (and how recently) this team bans it in this phase, how much the other team's
// players still to pick play it (recent league games + pubs since the last league night),
// and how often the division bans it in this phase. Early bans lean on habit and meta, late
// bans on the opponents' remaining pools. Each pick gives a still-unpicked player a hero
// from their own pool; the first picks favour heroes that get contested a lot (grab them
// before they're banned), the last picks are pure comfort.
// Game 2: pass game 1's steps and the team that won it as prev = { steps, winner }. Across
// S48, a third of the game 1 winner's heroes were banned in game 2 (a tenth of the loser's),
// and teams re-picked their own game 1 heroes about 12% of the time (winners) and 6% (losers).
export const G2_BAN = { winner: 0.06, loser: 0.02 };
export const G2_REPICK = { winner: 0.5, loser: 0.3 };
export function predictDraft(d, first, second, since, now = Date.now() / 1000, prev = null) {
  const w = (t) => 0.5 ** (Math.max(0, now - (t ?? now)) / HALF_LIFE);
  const drafted = d.games.filter((g) => g.draft?.length);
  const sideOf = (g, id) => (g.team_a_id === id ? "a" : g.team_b_id === id ? "b" : null);
  const phased = (g) => phasedDraft(g.draft);

  // Per team, per phase: recency-weighted ban habit (plus a little of its overall habit).
  const habit = (teamId) => {
    const by = [new Map(), new Map(), new Map()];
    let total = 0;
    for (const g of drafted) {
      const side = sideOf(g, teamId);
      if (!side) continue;
      const gw = w(g.start_time);
      total += gw;
      for (const s of phased(g)) if (s.kind === "ban" && s.side === side) by[Math.min(s.phase, 3) - 1].set(s.hero, (by[Math.min(s.phase, 3) - 1].get(s.hero) ?? 0) + gw);
    }
    return (h, phase) => (total ? ((by[phase - 1].get(h) ?? 0) + 0.3 * by.reduce((a, m) => a + (m.get(h) ?? 0), 0)) / total : 0);
  };
  const meta = [new Map(), new Map(), new Map()], contest = new Map();
  for (const g of drafted) {
    const seen = new Set();
    for (const s of phased(g)) {
      if (s.kind === "ban") meta[Math.min(s.phase, 3) - 1].set(s.hero, (meta[Math.min(s.phase, 3) - 1].get(s.hero) ?? 0) + 1);
      seen.add(s.hero);
    }
    for (const h of seen) contest.set(h, (contest.get(h) ?? 0) + 1);
  }
  const metaRate = (h, phase) => (drafted.length ? (meta[phase - 1].get(h) ?? 0) / (drafted.length * 2) : 0);
  const contestRate = (h) => (drafted.length ? (contest.get(h) ?? 0) / drafted.length : 0);

  // Player pools: recent league games x2 (decayed), pubs since the last league night x1.
  const pools = (team) => team.players.map((p) => {
    const score = new Map(), league = new Map(), pub = new Map();
    for (const g of d.games) for (const q of g.players) {
      if (String(q.account_id) !== String(p.account_id)) continue;
      score.set(q.hero, (score.get(q.hero) ?? 0) + 2 * w(g.start_time));
      league.set(q.hero, (league.get(q.hero) ?? 0) + 1);
    }
    for (const g of pubsSince(d, p.account_id, since)) {
      score.set(g.hero, (score.get(g.hero) ?? 0) + 1);
      pub.set(g.hero, (pub.get(g.hero) ?? 0) + 1);
    }
    const total = [...score.values()].reduce((a, b) => a + b, 0) || 1;
    return { player: p, share: (h) => (score.get(h) ?? 0) / total, heroes: [...score.keys()], league, pub };
  });

  const side = {
    X: { team: first, habit: habit(first.id), left: pools(first) },
    Y: { team: second, habit: habit(second.id), left: pools(second) },
  };
  const taken = new Set();
  const allHeroes = new Set([...contest.keys(), ...side.X.left.flatMap((p) => p.heroes), ...side.Y.left.flatMap((p) => p.heroes)]);
  const why = (p, h) => [p.league.get(h) ? `${p.league.get(h)} league game${p.league.get(h) === 1 ? "" : "s"}` : "", p.pub.get(h) ? `${p.pub.get(h)} recent pub${p.pub.get(h) === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");

  // hero -> team id that picked it in game 1
  const g1 = new Map((prev?.steps ?? []).filter((x) => x.kind === "pick" && x.hero).map((x) => [x.hero, x.team.id]));
  const role = (id) => (id === prev?.winner ? "winner" : "loser");
  const steps = [];
  CM_ORDER.forEach(([who, kind, phase], i) => {
    const us = side[who], them = side[who === "X" ? "Y" : "X"];
    const base = { n: i + 1, who, team: us.team, kind, phase };
    if (kind === "ban") {
      const [wHabit, wThreat, wMeta] = phase === 1 ? [1.0, 0.8, 0.8] : phase === 2 ? [0.6, 1.2, 0.3] : [0.4, 1.5, 0.2];
      let best = null;
      for (const h of allHeroes) {
        if (taken.has(h)) continue;
        const threatBy = them.left.map((p) => ({ p, v: p.share(h) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
        const threat = threatBy.reduce((a, x) => a + x.v, 0);
        const g1b = g1.get(h) === them.team.id ? G2_BAN[role(them.team.id)] : 0;
        const score = wHabit * us.habit(h, phase) + wThreat * threat + wMeta * metaRate(h, phase) + g1b;
        if (!best || score > best.score) best = { h, score, threatBy, habit: us.habit(h, phase), meta: metaRate(h, phase), g1b };
      }
      if (!best) return;
      taken.add(best.h);
      // Reasons in order of how much each one counted.
      const threat = best.threatBy.reduce((a, x) => a + x.v, 0);
      const reasons = [
        [wThreat * threat, threat >= 0.05 && best.threatBy[0] ? `${best.threatBy[0].p.player.name} plays it (${why(best.threatBy[0].p, best.h)})` : ""],
        [wHabit * best.habit, best.habit >= 0.1 ? `${us.team.name} ban it a lot` : ""],
        [wMeta * best.meta, best.meta >= 0.08 ? `a common phase ${phase} ban` : ""],
        [best.g1b, best.g1b ? `${them.team.name} played it in game 1${role(them.team.id) === "winner" ? " and won" : ""}` : ""],
      ].filter(([, t]) => t).sort((a, b) => b[0] - a[0]).map(([, t]) => t);
      steps.push({ ...base, hero: best.h, why: reasons.join(" · ") || "best ban left" });
    } else {
      const early = phase === 1 ? 1 : phase === 2 ? 0.4 : 0;
      let best = null;
      for (const p of us.left) for (const h of p.heroes) {
        if (taken.has(h)) continue;
        const score = p.share(h) * (1 + early * contestRate(h)) * (g1.get(h) === us.team.id ? G2_REPICK[role(us.team.id)] : 1);
        if (!best || score > best.score) best = { p, h, score };
      }
      if (!best) {
        const p = us.left.shift();
        steps.push({ ...base, hero: null, player: p?.player ?? null, why: "no hero pool in the data" });
        return;
      }
      taken.add(best.h);
      us.left = us.left.filter((p) => p !== best.p);
      steps.push({ ...base, hero: best.h, player: best.p.player, why: `${best.p.player.name}: ${why(best.p, best.h)}` });
    }
  });
  return steps;
}
