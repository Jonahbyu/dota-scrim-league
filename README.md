# Dota Scrim League

A for-fun league site for Dota 2 scrims. Players paste two post-game screenshots, the site
reads the stats out of them **in the browser** (Tesseract OCR — no AI, no API keys), the
uploader checks and fixes the numbers, and the game is saved to the league.

Static site: GitHub Pages hosts `public/` (published to the `gh-pages` branch with `npm run deploy`), data lives in Firestore (the shared
`pistachio-kitchen` Firebase project, under `scrimLeague/`).

## Uploading a game

1. After the game, on the post-game screen, snip the **overview** (hero cards with K/D/A and
   net worth) with Win+Shift+S and press Ctrl+V on the Upload page.
2. Open the **Scoreboard** tab, snip it, Ctrl+V again. Don't hover over anything — tooltips cover numbers.
3. Click **Read screenshots**, fix anything red or flagged, **Save to league**.

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
npm run deploy        # after committing
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

## Admin

Matches can't be edited or deleted from the site. To remove one:

```
npx firebase firestore:delete scrimLeague/data/matches/<id> --project pistachio-kitchen
```
