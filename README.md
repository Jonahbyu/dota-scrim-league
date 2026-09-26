# Dota 2 Scrim Circuit Tracker

**Live: https://dota2scrimcircuittracker.github.io/**

A for-fun stats site for Dota 2 scrims and our AD2L division.

- **Scrims** — paste two post-game screenshots; the stats are read **in your browser**
  (Tesseract OCR — no AI, no API keys), you check them, and the game is saved.
- **Scrim standings** — the scrim home page: every team ranked by game wins (then fewest
  losses), with win %, average kill difference, last-five form and streak, above the match
  list. Private scrims count.
- **AD2L S48 Champion** — switch league in the top-left: standings, every ticketed game
  with full stats, players and heroes, pulled from PlayOn + OpenDota.
- **AD2L S48 Heroic/Aegis** — a second division in the same switcher (PlayOn runs Heroic
  and Aegis as one season, 676), from its own `public/data/heroic.json` (`npm run heroic:sync`).
  Everything Champion has, under `#/heroic/`: standings, weekly, players, heroes, teams,
  predictions (picks stored with `league: "heroic"`) and unticketed uploads (Firestore
  `scrimLeague/data/heroic_unticketed`, same rules as Champion's). Scrim team lists stay
  Champion's. Forfeits against PlayOn's "Heroic Bye Week" placeholder aren't uploadable games.
  It plays in two divisions (A and B, read from PlayOn's Participants tables; the "Refund"
  table holds bye placeholders and is dropped). A switch under the header picks the view:
  Division A (`#/heroic/a/`), Division B (`#/heroic/b/`) or Combined (`#/heroic/`), each
  showing only that division's teams, series and games on every tab.
- **AD2L S48 Conqueror** — a third division in the switcher (PlayOn season 674), from
  `public/data/conqueror.json` (`npm run conqueror:sync`), under `#/conqueror/`. Same pages as
  Champion; predictions use `league: "conqueror"` and unticketed uploads go to
  `conqueror_unticketed`. One division, no A/B split. Divisions are one table (`DIVISIONS` in
  `public/app.js`): a new one needs an entry there, a sync script, a menu link, a colour, its
  collection in `lib/store.js` and the rules.
- **Tier list** (top of the Players tab) — every player with 3+ games, ranked S–D by in-season performance
  against same-role players plus win rate (see "Tier list" below).
- **Weekly recap** — one week at a time: highlights (player of the week, biggest damage,
  best KDA, top GPM, most kills) and every game with lineups and MVP. AD2L games also show
  the full Captains Mode draft in pick/ban order, grouped by series. (Scrims have no draft:
  it isn't on the post-game screen.)
- **Teams** — pick a team for its history: record, series/game results, roster, hero pool
  (W–L per hero), what they ban and what's banned against them (AD2L drafts), and player
  stats for that team. AD2L records come from PlayOn's series scores.
- **Private scrims** — tick "Private" on upload to post the result only (teams, winner,
  kill score, duration). Heroes, players and stats never leave the browser. Private games
  count toward team records but not the tier list, player or hero tables. The game ID is
  built from teams + kill score + duration only, so it can't be used to guess a private
  game's heroes.
- **Predictions** (AD2L → Predict) — type your name and call each series this week: a 2–0
  either way or 1–1. One point per correct call; picks lock at the series start (the
  database stamps each pick with server time, and scoring ignores anything stamped after the
  start). Standings group by the typed name, and "The model" competes using what it would
  have predicted each week from earlier weeks only. The model: team ratings fitted to every
  game result (PlayOn scores), pulled toward a roster-medal starting point, with the pull and
  medal weight tuned by replaying the season; games treated as independent (2–0 = p²).
  The model's call never hedges: it takes the favourite 2–0 (the odds bar stays honest).
  Each series has the model's full draft: all 24 steps in S48's Captains Mode order (first-pick
  team bans 3/2/2, the other 4/1/2), with a toggle for who has first pick. Bans weigh the
  team's recency-weighted ban habit in that phase, what the opponents still to pick have been
  playing (league games with a two-week half-life, pubs since the last league night), and the
  division's usual bans; picks give each player the best hero left in their pool. Stored in Firestore `scrimLeague/data/predictions`.
- **Scrim predictions** (Scrims → Predict) — anyone adds an upcoming scrim (two teams, start
  time, Bo1/Bo2/Bo3); everyone calls it until it starts, same name-based leaderboard as AD2L.
  Each card has **Upload game N** and **Private result** buttons that open the upload page with
  the scrim's team names filled in (and a one-click fix if the in-game names differ). No link
  is stored: a game counts toward a scrim when it's between the same two teams and was uploaded
  from 2 hours before the start to 3 days after (`public/lib/fixtures.js`). Odds come from a
  rating per team fitted to every scrim result, pulled toward even. Stored in Firestore
  `scrimLeague/data/scrim_fixtures`; picks share `predictions` with `league: "scrim"`.
- **Recent pubs** (AD2L) — each rostered player's public/ranked games since the last league
  night (smurfs included), from OpenDota at sync time: columns on the Players table and a
  section on player pages.
- **Unticketed AD2L games** — AD2L → Upload: Champion division games played without a
  league ticket (so OpenDota's league list never has them) are uploaded from screenshots
  exactly like a scrim. Team names must be division teams (picked from a list, or filled in
  from whose roster most players are on); player names are matched to roster accounts so the
  games count on the same player pages. They show as "Unticketed" and count on team, player,
  hero, weekly and tier pages; standings stay PlayOn's series scores. No draft, gold or ward
  data (those come from replays). Stored in Firestore `scrimLeague/data/ad2l_unticketed`,
  same rules as scrims.
- **Editing and deleting** — whoever uploaded a game can edit or delete it from the browser
  they uploaded it in; anyone else needs the league password (see "Editing and deleting").
- **Player pages** — click any player name: record, KDA, GPM, damage, kill participation,
  tier, best games, hero pool (W–L per hero) and every game they played (sortable).
- **Gold graphs** (AD2L) — each game: gold lead minute by minute with each side's biggest lead
  marked, XP lead, and every player's gold. Team pages: average lead curve, record when
  ahead/behind at 20', comebacks and throws (5k+ leads). Player and hero pages: average
  gold curve against the division's average core and support. Weekly: biggest comeback.
  Data is OpenDota's parsed-replay gold (total gold earned, like OpenDota's own graph).
- **Map & objectives** (AD2L, from parsed replays) — per game: lane / neutral / ancient creep
  kills, camps stacked, observers and sentries placed, dewards, Roshan and Tormentor last hits,
  and a timeline of who took each Roshan and Tormentor (also marked on the gold chart).
  Per-game averages on the Players table and player pages; team pages show Roshans and
  Tormentors taken vs given up, first-Roshan rate, and wards / dewards / stacks per game;
  Weekly adds most wards, stacks and dewards. Hero pages and the Heroes table show ban
  and contest rate (picked or banned per drafted game).
- **Draft** (AD2L) — a Draft page with bans and picks per hero split by Captains Mode phase
  (phase 1 = opening 7 bans + first 2 picks, phase 2 = 3 bans + 6 picks, phase 3 = last 4
  bans + last 2 picks; read from each draft, not hard-coded), win % per pick phase, first-pick
  win rate. Hero pages show the same by phase; player and hero pages show the record by the
  team's pick number (1st … last pick) and flag a big last-pick gap; team pages split their
  bans, bans against them and picks by phase. Heroes and Draft tables hide heroes under a
  minimum number of games (default 3, changeable) so one-off 100% heroes don't top the list.
- **Ward maps** (AD2L) — every observer and sentry position from the replay. Game pages show
  both teams as dots (hover for time placed, how long it lasted, dewarded or not); player,
  hero and team pages show a heat map of all their wards with Dire games mirrored so it's
  always "own base bottom left". Filter by ward type and game phase (0–10', 10–20', 20–35',
  35'+). Drawn on the minimap picture in `public/img/minimap.webp`, lined up by its two
  fountains against where players stand before the horn (both axes 4.25 px per map unit).
- **Tower maps** (AD2L game pages) — every tower, barracks and Ancient on the same minimap,
  by the same game phases: what's standing at the end of the phase, what fell in it (with
  the time on the map) and what fell earlier (faded). Hover for who took it, creeps, or a
  deny. From OpenDota's building kills (`buildings` in `ad2l.json`). Building spots are
  hand-placed along the lanes, not from replay coordinates, so they can be a map unit or two off.
- **Hero pages** — click any hero: record, pick and ban rates, average draft slot (AD2L),
  best team and player on it, biggest games, a teams table (picks, W–L, win % on the hero,
  who played it, bans for and against), a players table and every game it was in.
- **Strength of schedule** (AD2L standings) — RPI-style: opponents' game win % (without
  their games against you) and their opponents' win %, plus how tough the remaining
  schedule is. Team names link to team pages everywhere on the site.
- Every table sorts: click a column header (↕), or use the "Sort by" menu on player tables.
- Match pages with standouts (damage per net worth, kill participation, damage share),
  sortable player and hero leaderboards.

Static site: every push to `main` deploys `public/` to GitHub Pages via GitHub Actions
(`.github/workflows/pages.yml`).

**Firebase key:** `public/firebase-config.js` is not committed. The Actions workflow writes
it from the `FIREBASE_WEB_API_KEY` repository secret; locally, run
`FIREBASE_WEB_API_KEY=... npm run config:write` once. It's a public web key by design (the
browser receives it), so what actually protects the project is the key's website
restriction (only our GitHub Pages sites and localhost — `scripts/restrict-api-key.cjs`)
and the Firestore rules.
Scrim data lives in Firestore (the shared `pistachio-kitchen` Firebase project, under
`scrimLeague/`); AD2L data is a static file rebuilt by `npm run ad2l:sync`.

## Tier list

`public/lib/tiers.js`, same for both leagues:

    score = stat points (out of 100) × survival × consistency × opponents × winning

Every point is shown: click a player on the tier list, or open their page. The stat rows add up
to the stat points and each multiplier shows the points it adds or removes.

- **Role** from the replay's position (1–3 core, 4–5 support); games without one (screenshot
  uploads, scrims) use net worth rank in the team. Each game is scored in the role played.
- **Stats** — each game, each stat is a z-score against the same position (capped at ±2.5).
  Farm, hero damage, building damage, XP, kills and assists are shares of the team's total, so
  long games don't inflate them. GPM, net worth and support stacks (per game) are compared with the position's
  straight-line fit on game length. Lane result = gold + XP lead at 10 min over the lane
  opponent (cores: the opposite core; supports: lane pair vs pair). Each stat is then on its own
  0–100 per role: a player's average, padded with 3 games at the position average; 100 = the
  league's best such average (players with 3+ games in the role), 0 = the worst. Support
  stacks are easier: 100 sits 70% of the way from the worst stacker to the best.
- **Stat points** out of 100 — cores: damage share 15, farm share 15, kill share 13, GPM 13,
  net worth 10, XP share 8, assist share 8, building share 5, lane result 5, laning 4, stun time 4.
  Supports: dewards 15, assist share 13, ward uptime 13, stun time 8, stacks 8, kill share 8,
  lane result 7, healing 5, damage share 4, sentries 4, dust 3, smokes 3, GPM 3, farm share 2, net
  worth 2, building share 2.
- **Survival** ×0.85–1.00: deaths 40%, time dead 35%, hero damage taken per life 25%, each on its
  own 0–100.
- **Consistency** ×0.90–1.00: the spread of the player's series stat points, pulled toward the
  league's typical spread by 2 series; steadiest player 1.00, streakiest 0.90.
- **Opponents** ×0.90–1.10: each opponent's game win % outside games against this team, padded
  with 6 even games (25% → 0.90, 75% → 1.10); each series takes its opponent's factor and the
  season multiplier weights series by their stat points.
- **Series**: each series shows its stat points (same padding as the season, uncapped) and score
  (× its opponent factor and the season's other multipliers); weighted by games they average to
  the season's stat points and score exactly.
- **Winning** ×0.70–1.30: two parts win rate (padded with 6 even games; 25% → 0, 75% → 100) to
  one part win speed (share of the league's wins that took longer, padded with 3 average wins).
- **Rating** = the score on a normal curve fitted to the league: the median player rates 50,
  width 1.5 × the spread of scores. The breakdown shows it as a "Rating curve" row (rating −
  score), the one step that compares a player with the rest of their league.
- **Each league is scored on its own**: every AD2L division and the scrim ledger has its own
  position averages, 100s and 0s, and curve, so a rating ranks a player within their league.
  The Heroic A/B views use the whole Heroic/Aegis division's reference.
- **Tiers** by fixed rating: S 85+, A 65+, B 45+, C 30+, D below (roughly 10/15/35/25/15% per
  division right now). Needs 3+ games. PlayOn medal badges are shown, not scored.

## Uploading a game

1. After the game, on the post-game screen, snip the **overview** (hero cards with K/D/A and
   net worth) with Win+Shift+S and press Ctrl+V on the Upload page.
2. Open the **Scoreboard** tab, snip it, Ctrl+V again. Don't hover over anything — tooltips cover numbers.
3. Click **Read screenshots**, fix anything red or flagged, **Save to league**.

Player names are checked against every name the site knows: the AD2L Champion rosters
(plus stand-ins from the division's games) and names from earlier scrims. Close misreads
are fixed automatically ("Icarus<" → Icarus, "MERCURY" → Merc-Ury) and listed so you can
see what changed; looser resemblances ("Daddy Kaleb" ~ Kaleb) are offered as a one-click
suggestion, since an in-game name can differ from a roster name on purpose.

The same game uploaded by both teams is detected and saved once.

## What's read, and how well

Hero, level, K/D/A, net worth, LH/DN, GPM, XPM, heal, hero damage, team names, score,
duration, winner. Clan tags aren't read (the tag font defeats OCR); type them if you want them.

Measured on one real game (`npm run ocr:robustness`, needs the local test screenshots):
99% of fields exact on the original, 96–99% for 4K-size, tighter/looser crops and JPEG,
~83% when the screenshot has been shrunk to 1440p-size (real 1440p captures are sharper
than that test). One game is a small sample — the review step is there for the misses.

## AD2L view (top-left switcher)

The switcher flips between our scrims and **AD2L S48 Champion**: standings, every
ticketed game with full stats, players and heroes for that one division.

It's a static file, `public/data/ad2l.json`, rebuilt with:

```
npm run ad2l:sync     # ~3 min first run; cached after that
npm run heroic:sync   # same for the Heroic division -> public/data/heroic.json
git commit -am "Update AD2L data" && git push   # Actions redeploys the site
```

How it finds games (all public data, no keys): PlayOn gives the division's teams,
rosters (account ids + smurfs) and series scores; OpenDota has no match list for this
amateur league, so the sync walks every rostered account's practice-lobby games since the
season started and keeps the ones tagged with the season's Dota league id (S48 = 20077)
where both sides are Champion rosters. Stand-ins are kept and labelled.

Coverage check on the first run: 38 of the 40 games the series scores say were played
(a game can be missed if nobody on either side has public match history for it).
Other divisions/seasons: `node scripts/ad2l-sync.js --season <playon id> --league <dota league id>`
(PlayOn ids are on dota.playon.gg/seasons; the Dota league id is on OpenDota's league list).

## Develop

```
npm install
npm start               # http://localhost:3000 — serves public/ like GitHub Pages does
npm test                # logic tests; the OCR test runs only if test-screenshots/ exists
npm run ocr:check       # OCR accuracy on the local test screenshots
npm run rules:test      # evaluate the Firestore rules against sample requests (no deploy)
```

Layout: `public/lib/ocr/` is the OCR (shared by the site and the Node tests — only
`engine-browser.js` / `lib/ocr-node.js` differ), `public/lib/store.js` is Firestore,
`public/lib/stats.js` the leaderboards.

## Firestore rules

The project has one ruleset shared with Cookbook and Maze Racer, deployed from the Cookbook
repo. This app's block lives in `firebase/scrimleague.rules`. To change it:

```
# edit firebase/scrimleague.rules, then:
node scripts/merge-rules.cjs ../Cookbook/firestore.rules
npm run rules:test -- ../Cookbook/firestore.rules    # must all PASS
cd ../Cookbook && npx firebase deploy --only firestore:rules --project pistachio-kitchen
```

Rules are limited to 1000 evaluated expressions per request; per-player checks are packed
tight to fit (see the comment in the rules file). Re-run the dry test after any change.

## Editing and deleting

Open the game. Whoever uploaded it (from the same browser) sees **Edit** and **Delete**
straight away; anyone else opens **Edit or delete this scrim** and types the league password.

- **Edit** loads the game into the upload review form: fix names, heroes, stats, teams,
  score or winner and press **Save changes**. The game keeps its ID, upload date (so its
  week), uploader, private flag and AD2L series; the rules check the same shape as a new
  upload. The ID is still the one from the original teams and score, so a later upload of
  the same game with the corrected values won't be caught as a duplicate.
- **Delete** removes it for everyone.

The password is a speed bump, not security: it's in `app.js`, and the rules let any
signed-in visitor edit or delete an upload. The admin can also delete from the command line:

```
npx firebase firestore:delete scrimLeague/data/matches/<id> --project pistachio-kitchen
```
