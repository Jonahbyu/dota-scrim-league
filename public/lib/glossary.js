// Info bubbles: a small "i" next to a stat's label that explains it. One popover for the
// whole page; hover shows it with a mouse, tap/click pins it (the only way on phones),
// Escape or a click elsewhere closes it. Obvious labels (K, D, A, Games, Win %) get none.

export const INFO = {
  // Series standings (AD2L)
  w: "Series won 2–0.",
  tie: "Series tied 1–1. AD2L series are two games, so ties are common.",
  l: "Series lost 0–2.",
  game_rate: "Games won ÷ games played, from PlayOn's series scores.",
  tracked: "Games whose full stats were found on OpenDota. A game can be missing when nobody in it has public match history.",
  record: "Series won–tied–lost.",
  sos: "Strength of schedule: (2 × opponents' game win % + their opponents' game win %) ÷ 3, the same idea as RPI. Higher = tougher opponents so far.",
  owp: "Opponents' game win %, leaving out their games against this team, so beating them doesn't make your own schedule look easier.",
  oowp: "How tough the opponents' own schedules were: their opponents' game win %.",
  faced: "Every series played, oldest first: green won, red lost, grey tied. Hover a square for the score.",
  remaining_sos: "Average game win % of the opponents still to play. Higher = harder run-in.",

  // Scrim standings
  gp: "Games played, private scrims included.",
  kill_diff: "Average kill score difference per game: the team's kills minus the opponent's.",
  form: "The last five games, oldest first.",
  streak: "Current run of wins (W) or losses (L), e.g. W3 = three wins in a row.",

  // Player stats (across games)
  kda: "(Kills + assists) ÷ deaths, over all games. Zero deaths counts as one.",
  avg_gpm: "Gold per minute over all games: total gold ÷ total minutes, so long games count for more than short ones.",
  avg_xpm: "Experience per minute over all games: total XP ÷ total minutes.",
  dmg_per_min: "Damage to enemy heroes ÷ minutes played.",
  dmg_per_1k_nw: "Hero damage per 1,000 net worth: how much damage a player gets out of their gold. Supports often score high.",
  avg_kp: "Kill participation: (kills + assists) ÷ team kills, averaged over games.",
  stacks_pg: "Neutral camps stacked per game (parsed replays).",
  obs_pg: "Observer wards placed per game (parsed replays).",
  sen_pg: "Sentry wards placed per game (parsed replays).",
  dewards_pg: "Enemy observer and sentry wards killed per game (parsed replays).",
  lane_pg: "Lane creeps killed per game (parsed replays).",
  neutral_pg: "Neutral creeps killed per game (parsed replays).",
  neutral_share: "Neutral creeps as a share of all creeps killed (lane + neutral). High = farms the jungle.",
  roshans: "Roshan last hits, total.",
  tormentors: "Tormentor last hits, total.",
  pub_games: "Public and ranked games since the last league night, smurf accounts included. From OpenDota at the last sync.",
  pub_win_rate: "Win % in those recent pubs.",
  pub_kda: "(Kills + assists) ÷ deaths in those recent pubs.",
  pub_heroes: "Heroes played in those recent pubs, most played first.",

  // One game
  net_worth: "Gold held plus the value of items at the end of the game.",
  last_hits: "Last hits: creeps killed for gold.",
  gpm: "Gold per minute in this game.",
  xpm: "Experience per minute in this game.",
  hero_damage: "Damage dealt to enemy heroes.",
  dmg_share: "Share of the team's total hero damage.",
  kill_participation: "Kill participation: (kills + assists) ÷ the team's kills.",
  hero_healing: "Healing done to allied heroes.",
  lane_kills: "Lane creeps killed.",
  neutral_kills: "Neutral creeps killed.",
  ancient_kills: "Ancient creeps killed.",
  camps_stacked: "Neutral camps stacked.",
  obs_placed: "Observer wards placed.",
  sen_placed: "Sentry wards placed.",
  obs: "Observer wards placed.",
  sen: "Sentry wards placed.",
  stacks: "Neutral camps stacked.",
  dewards: "Enemy observer and sentry wards killed.",
  roshan_kills: "Roshan last hits. The chips above show which team took each one.",
  tormentor_kills: "Tormentor last hits.",

  // Heroes and drafts
  pick_rate: "Share of games (with stats) it was picked in.",
  ban_rate: "Bans ÷ drafted games.",
  contest_rate: "Share of drafted games it was picked or banned in. The best single measure of how much teams care about a hero.",
  b1: "Bans in draft phase 1: the opening 7 bans.",
  b2: "Bans in draft phase 2: the 3 bans between the first 2 picks and the next 6.",
  b3: "Bans in draft phase 3: the last 4 bans.",
  p1_ban_share: "Share of its bans that came in phase 1. High = teams remove it on sight.",
  p1: "Picks in phase 1: the first 2 picks of the draft.",
  w1: "Win % when picked in phase 1.",
  p2: "Picks in phase 2: the middle 6 picks.",
  w2: "Win % when picked in phase 2.",
  p3: "Picks in phase 3: the last 2 picks, one per team.",
  w3: "Win % when picked in phase 3 (last pick).",
  avg_damage: "Average hero damage per game on this hero.",
  avg_kda: "Average of each game's KDA on this hero.",
  team_hero_wr: "That team's record when they picked this hero.",
  team_bans: "Times this team banned it.",
  banned_against: "Times opponents banned it against this team.",
  first_pick: "Games won by the team with the first pick of the draft.",
  top_p1_ban: "Banned most in phase 1 (the opening 7 bans). Below: how many of its bans came in phase 1.",
  top_p1_pick: "Picked most in phase 1 (the first 2 picks), with its record when picked there.",
  last_pick: "A team's fifth and final pick. It comes last, so it can counter everything already on the board.",
  best_last_pick: "Best record as a team's last pick, among heroes last-picked 3+ times.",
  draft_slot: "Average position of its pick in the draft, counting all 24 steps (bans and picks). Lower = taken earlier.",
  by_draft_pick: "Record by which of the team's five picks this hero came in (1st pick … last pick). A big last-pick gap means it works best as a counter-pick.",
  draft_by_phase: "What this team bans, what gets banned against them and what they pick, split by draft phase. Phase 1 = opening 7 bans and first 2 picks; phase 2 = 3 bans and 6 picks; phase 3 = last 4 bans and last 2 picks.",
  hero_phases: "When this hero gets banned or picked in Captains Mode drafts, split by phase.",

  // Player / team cards
  tier: "Tier list rank (S–D) among players with 3+ games. Rating is the percentile, 0–100. See “How it's scored” on the Players page.",
  vision: "Observer / sentry wards placed per game.",
  creeps: "Lane / neutral creeps killed per game, and the neutral share of all creeps.",
  objectives: "Roshan / Tormentor last hits, total.",
  avg_kills: "Average kills per game by this team; the line below is kills against them.",
  team_roshans: "Roshans taken vs given up, whole team.",
  first_roshan: "Of the games where Roshan died, how many this team took the first one.",
  team_tormentors: "Tormentors taken vs given up, whole team.",
  team_wards: "Observers / sentries placed per game by the whole team.",
  team_dewards: "Enemy wards killed per game by the whole team.",
  team_stacks: "Camps stacked per game by the whole team.",
  ahead20: "Record in games where they had more gold at 20 minutes.",
  behind20: "Record in games where they had less gold at 20 minutes.",
  comebacks: "Wins after trailing by 5k+ gold at some point.",
  throws: "Losses after leading by 5k+ gold at some point.",

  // Weekly / match
  mvp: "A game's MVP is the winning-side player with the best average of damage share, kill participation and net-worth share. Player of the week has the most MVPs.",
  biggest_comeback: "The biggest gold lead a team lost the game from this week.",
  team_damage: "Total hero damage by each team.",
  gold_lead: "Gold difference between the teams at each minute, from the parsed replay. Each side's biggest lead is marked; Roshans and Tormentors are marked too.",
  gold_players: "Each player's gold at each minute, from the parsed replay.",
  gold_curve: "Average gold at each minute against the division's average core and support. Core = a team's top 3 by net worth, support = the other 2.",
  team_gold: "Average gold lead at each minute over this team's games with replay data. Above the line = ahead.",
  ward_map: "Where wards were placed, from parsed replays. Own base is always bottom left (Dire games are mirrored).",
  match_wards: "Every ward both teams placed, from the parsed replay.",
  tower_map: "Which towers and barracks were still standing at the end of each game phase, and when each one fell. From the parsed replay.",
  map_objectives: "Creeps, stacks, wards and objectives per player, from the parsed replay.",
  tier_list: "Players with 3+ games ranked S–D: 70% per-minute impact against same-role players, 30% win rate pulled toward 50%. Hover a player for the breakdown.",
  strength_of_schedule: "How tough each team's opponents have been, and how tough the rest of the schedule is.",
  recent_pubs: "Public and ranked games since the last league night, from OpenDota, smurf accounts included.",
  pub_record: "Wins–losses in recent pubs.",

  // Predictions
  points: "Correct calls / series called.",
  correct: "Share of calls that were right.",
  model_col: "What the model would have picked, using only results from before it. Where shown, the % is the chance it gave the actual result.",
  crowd_col: "The most-picked call, and how many people picked.",
  you_col: "Your call, matched by the name you pick with.",
  model_draft: "The model's guess at all 24 draft steps. Hover any step for why it was chosen.",
  player_pools: "Each player's likeliest heroes: league games (recent weeks count most) plus pubs since the last league night, discounted by the chance the other team bans it. % = rough chance they play it.",
};

export function info(id) {
  if (!INFO[id]) return "";
  return `<button type="button" class="info" data-info="${id}" aria-label="What is this?" aria-expanded="false">i</button>`;
}

let pop = null, owner = null, pinned = false;

function place() {
  const r = owner.getBoundingClientRect(), gap = 8, edge = 12;
  pop.style.left = "0px"; pop.style.top = "0px";
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.min(Math.max(edge, r.left + r.width / 2 - w / 2), window.innerWidth - w - edge);
  const below = r.bottom + gap + h <= window.innerHeight - edge || r.top - gap - h < edge;
  pop.style.left = `${left}px`;
  pop.style.top = `${below ? r.bottom + gap : r.top - gap - h}px`;
}

function show(btn, pin) {
  if (owner && owner !== btn) hide();
  owner = btn;
  pinned = pin;
  pop.textContent = INFO[btn.dataset.info] ?? "";
  pop.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  btn.setAttribute("aria-describedby", "info-pop");
  place();
}

function hide() {
  if (!owner) return;
  owner.setAttribute("aria-expanded", "false");
  owner.removeAttribute("aria-describedby");
  owner = null;
  pinned = false;
  pop.hidden = true;
}

export function wireInfo() {
  pop = document.createElement("div");
  pop.id = "info-pop";
  pop.className = "info-pop";
  pop.setAttribute("role", "tooltip");
  pop.hidden = true;
  document.body.append(pop);

  // Capture phase, so a bubble inside a sortable header, a <summary> or a link card opens
  // itself instead of sorting, toggling or navigating.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".info");
    if (btn) {
      e.preventDefault(); e.stopPropagation();
      if (owner === btn && pinned) hide(); else show(btn, true);
      return;
    }
    if (owner && !pop.contains(e.target)) hide();
  }, true);

  const canHover = window.matchMedia?.("(hover: hover)").matches;
  if (canHover) {
    document.addEventListener("mouseover", (e) => {
      const btn = e.target.closest?.(".info");
      if (btn && !pinned) show(btn, false);
    });
    document.addEventListener("mouseout", (e) => {
      const btn = e.target.closest?.(".info");
      if (btn && btn === owner && !pinned && !btn.contains(e.relatedTarget)) hide();
    });
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && owner) { const b = owner; hide(); b.focus(); } });
  window.addEventListener("scroll", () => owner && (pinned ? place() : hide()), { passive: true, capture: true });
  window.addEventListener("resize", () => owner && place());
  window.addEventListener("hashchange", hide);
}
