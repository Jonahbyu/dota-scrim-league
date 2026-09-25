// Evaluate the merged rules against simulated requests with the Firebase Rules test API
// (projects.test) — nothing is deployed. Usage: node scripts/rules-dry-test.cjs <firestore.rules>
const fs = require("fs");
const { requireAuth } = require("firebase-tools/lib/requireAuth");
const { Client } = require("firebase-tools/lib/apiv2");

const source = fs.readFileSync(process.argv[2], "utf8");
const PATH = "/databases/(default)/documents/scrimLeague/data/matches/00000000000000000000000000000001";
const NOW = "2026-09-24T04:00:00Z";

const player = (i) => ({
  team: i < 5 ? "a" : "b", name: `Rules Test Player ${i + 1}`, tag: null, hero: "Kez",
  level: 20, kills: 2, deaths: 2, assists: 5, net_worth: 15000, last_hits: 200, denies: 5,
  gpm: 450, xpm: 600, hero_damage: 15000, hero_healing: 0,
});
const match = (extra = {}) => ({
  v: 2, private: false, team_a: "Rules Test A", team_b: "Rules Test B", score_a: 10, score_b: 10, winner: "a",
  duration_sec: 2400, game_mode: "Captains Mode", players: [...Array(10)].map((_, i) => player(i)),
  uid: "u1", createdAt: NOW, ...extra,
});
const privateMatch = (extra = {}) => { const m = match({ private: true, ...extra }); delete m.players; return m; };
const req = (data, auth = { uid: "u1" }) => ({ auth, method: "create", path: PATH, time: NOW, resource: { data } });
// Delete: `existing` is the stored document the rule sees as `resource`.
const del = (existing, auth) => ({ request: { auth, method: "delete", path: PATH, time: NOW }, resource: { data: existing } });

// Update: `existing` is the stored document, `data` what the edit writes.
const upd = (existing, data, auth = { uid: "u2" }, path = PATH) => ({ request: { auth, method: "update", path, time: "2026-09-25T04:00:00Z", resource: { data } }, resource: { data: existing } });
const UNT_PATH = PATH.replace("/matches/", "/ad2l_unticketed/");
const PRED_PATH = "/databases/(default)/documents/scrimLeague/data/predictions/20621_u1";
const pred = (extra = {}) => ({ v: 1, league: "ad2l", series_id: 20621, pick: "home", name: "Rules Test", uid: "u1", updatedAt: NOW, ...extra });
const predReq = (data, auth = { uid: "u1" }) => ({ auth, method: "create", path: PRED_PATH, time: NOW, resource: { data } });
const FIX_ID = "AbCdEfGhIjKlMnOpQrSt";
const FIX_PATH = `/databases/(default)/documents/scrimLeague/data/scrim_fixtures/${FIX_ID}`;
const fixture = (extra = {}) => ({ v: 1, team_a: "Rules Test A", team_b: "Rules Test B", start: "2026-09-26T02:00:00Z", best_of: 2, uid: "u1", createdAt: NOW, ...extra });
const fixReq = (data, auth = { uid: "u1" }, path = FIX_PATH) => ({ auth, method: "create", path, time: NOW, resource: { data } });
const fixUpd = (existing, data, auth = { uid: "u2" }) => ({ request: { auth, method: "update", path: FIX_PATH, time: NOW, resource: { data } }, resource: { data: existing } });
const SCRIM_PRED_PATH = `/databases/(default)/documents/scrimLeague/data/predictions/${FIX_ID}_u1`;
const withPlayer = (i, change) => ({ ...match(), players: match().players.map((p, j) => (j === i ? change({ ...p }) : p)) });
const cases = [
  ["valid match", req(match()), "ALLOW"],
  ["valid, long names + max level + big numbers", req(withPlayer(9, (p) => ({ ...p, name: "N".repeat(32), hero: "Vengeful Spirit", level: 30, hero_damage: 150000, tag: "TAG" }))), "ALLOW"],
  ["no auth", req(match(), null), "DENY"],
  ["someone else's uid", req(match({ uid: "u2" })), "DENY"],
  ["client createdAt", req(match({ createdAt: "2020-01-01T00:00:00Z" })), "DENY"],
  ["extra top-level field", req(match({ admin: true })), "DENY"],
  ["v missing", req((() => { const m = match(); delete m.v; return m; })()), "DENY"],
  ["same team twice", req(match({ team_b: "rules test a" })), "DENY"],
  ["winner 'c'", req(match({ winner: "c" })), "DENY"],
  ["duration 30s", req(match({ duration_sec: 30 })), "DENY"],
  ["score as string", req(match({ score_a: "10" })), "DENY"],
  ["9 players", req({ ...match(), players: match().players.slice(0, 9) }), "DENY"],
  ["level 99", req(withPlayer(3, (p) => ({ ...p, level: 99 }))), "DENY"],
  ["kills as string", req(withPlayer(0, (p) => ({ ...p, kills: "9" }))), "DENY"],
  ["gpm as float", req(withPlayer(2, (p) => ({ ...p, gpm: 450.5 }))), "DENY"],
  ["extra player field", req(withPlayer(1, (p) => ({ ...p, mmr: 5000 }))), "DENY"],
  ["missing player field", req(withPlayer(1, (p) => { delete p.denies; return p; })), "DENY"],
  ["team B slot marked a", req(withPlayer(6, (p) => ({ ...p, team: "a" }))), "DENY"],
  ["hero name 100 chars", req(withPlayer(5, (p) => ({ ...p, hero: "H".repeat(100) }))), "DENY"],
  ["name is a number", req(withPlayer(4, (p) => ({ ...p, name: 42 }))), "DENY"],
  ["old v1 shape", req(match({ v: 1 })), "DENY"],
  ["private: results only", req(privateMatch()), "ALLOW"],
  ["private but with players", req(match({ private: true })), "DENY"],
  ["public but without players", req((() => { const m = match(); delete m.players; return m; })()), "DENY"],
  ["private flag missing", req((() => { const m = privateMatch(); delete m.private; return m; })()), "DENY"],
  ["private flag not a bool", req(privateMatch({ private: "yes" })), "DENY"],
  ["private with extra field", req(privateMatch({ heroes: "Kez" })), "DENY"],
  ["private, bad winner", req(privateMatch({ winner: "c" })), "DENY"],
  ["valid match with pick order", req({ ...match(), players: match().players.map((p, i) => ({ ...p, pick: i + 1 })) }), "ALLOW"],
  ["unticketed with pick order", { ...req({ ...match({ series_id: 20690 }), players: match().players.map((p, i) => ({ ...p, pick: 10 - i })) }), path: PATH.replace("/matches/", "/ad2l_unticketed/") }, "ALLOW"],
  ["worst case: long names + big numbers + pick order", req({ ...match(), players: match().players.map((p, i) => ({ ...p, name: "N".repeat(32), hero: "Vengeful Spirit", level: 30, hero_damage: 150000, tag: "TAG", pick: i + 1 })) }), "ALLOW"],
  ["pick as float", req(withPlayer(2, (p) => ({ ...p, pick: 2.5 }))), "DENY"],
  ["pick as string", req(withPlayer(2, (p) => ({ ...p, pick: "3" }))), "DENY"],
  ["pick in place of a stat", req(withPlayer(2, (p) => { delete p.denies; return { ...p, pick: 3 }; })), "DENY"],
  ["pick plus an extra field", req(withPlayer(2, (p) => ({ ...p, pick: 3, mmr: 1 }))), "DENY"],
  ["unticketed with series_id", { ...req(match({ series_id: 20690 })), path: PATH.replace("/matches/", "/ad2l_unticketed/") }, "ALLOW"],
  ["worst case: unticketed + series_id + long names + pick order", { ...req({ ...match({ series_id: 20690 }), players: match().players.map((p, i) => ({ ...p, name: "N".repeat(32), hero: "Vengeful Spirit", level: 30, hero_damage: 150000, tag: "TAG", pick: i + 1 })) }), path: PATH.replace("/matches/", "/ad2l_unticketed/") }, "ALLOW"],
  ["scrim with series_id", req(match({ series_id: 20690 })), "DENY"],
  ["unticketed, series_id as string", { ...req(match({ series_id: "20690" })), path: PATH.replace("/matches/", "/ad2l_unticketed/") }, "DENY"],
  ["unticketed, series_id plus extra field", { ...req(match({ series_id: 20690, admin: true })), path: PATH.replace("/matches/", "/ad2l_unticketed/") }, "DENY"],
  ["private scrim with series_id", req(privateMatch({ series_id: 20690 })), "DENY"],
  ["uploader deletes own scrim", del(match(), { uid: "u1" }), "ALLOW"],
  ["someone else deletes it (anyone signed in may)", del(match(), { uid: "u2" }), "ALLOW"],
  ["delete in an unknown collection", { ...del(match(), { uid: "u1" }), request: { ...del(match(), { uid: "u1" }).request, path: PATH.replace("/matches/", "/anything/") } }, "DENY"],
  ["signed-out delete", del(match(), null), "DENY"],
  ["admin deletes any", del(match(), { uid: "admin", token: { email: "jonahbyu@gmail.com" } }), "ALLOW"],
  ["unticketed AD2L game", { ...req(match({ series_id: 20690 })), path: PATH.replace("/matches/", "/ad2l_unticketed/") }, "ALLOW"],
  ["unticketed without series_id", { ...req(match()), path: PATH.replace("/matches/", "/ad2l_unticketed/") }, "DENY"],
  ["unticketed, bad shape", { ...req(match({ series_id: 20690, admin: true })), path: PATH.replace("/matches/", "/ad2l_unticketed/") }, "DENY"],
  ["unknown collection", { ...req(match()), path: PATH.replace("/matches/", "/anything/") }, "DENY"],
  ["prediction: valid", predReq(pred()), "ALLOW"],
  ["prediction: change own pick (update)", { ...predReq(pred({ pick: "tie" })), method: "update" }, "ALLOW"],
  ["prediction: id for another uid", { ...predReq(pred()), path: PRED_PATH.replace("_u1", "_u2") }, "DENY"],
  ["prediction: id for another series", { ...predReq(pred({ series_id: 99 })) }, "DENY"],
  ["prediction: client timestamp", predReq(pred({ updatedAt: "2020-01-01T00:00:00Z" })), "DENY"],
  ["prediction: bad pick", predReq(pred({ pick: "2-0" })), "DENY"],
  ["prediction: empty name", predReq(pred({ name: "" })), "DENY"],
  ["prediction: 40-char name", predReq(pred({ name: "N".repeat(40) })), "DENY"],
  ["prediction: extra field", predReq(pred({ points: 99 })), "DENY"],
  ["prediction: signed out", predReq(pred(), null), "DENY"],
  ["prediction: scrim fixture", { ...predReq(pred({ league: "scrim", series_id: FIX_ID })), path: SCRIM_PRED_PATH }, "ALLOW"],
  ["prediction: scrim with a number id", { ...predReq(pred({ league: "scrim" })) }, "DENY"],
  ["prediction: ad2l with a fixture id", { ...predReq(pred({ series_id: FIX_ID })), path: SCRIM_PRED_PATH }, "DENY"],
  ["prediction: unknown league", predReq(pred({ league: "nba" })), "DENY"],
  ["fixture: valid", fixReq(fixture()), "ALLOW"],
  ["fixture: Bo3 two days ahead", fixReq(fixture({ best_of: 3 })), "ALLOW"],
  ["fixture: signed out", fixReq(fixture(), null), "DENY"],
  ["fixture: someone else's uid", fixReq(fixture({ uid: "u2" })), "DENY"],
  ["fixture: client createdAt", fixReq(fixture({ createdAt: "2020-01-01T00:00:00Z" })), "DENY"],
  ["fixture: same team twice", fixReq(fixture({ team_b: "rules test a" })), "DENY"],
  ["fixture: Bo5", fixReq(fixture({ best_of: 5 })), "DENY"],
  ["fixture: start as string", fixReq(fixture({ start: "tomorrow" })), "DENY"],
  ["fixture: start a year out", fixReq(fixture({ start: "2027-09-26T02:00:00Z" })), "DENY"],
  ["fixture: start a week ago", fixReq(fixture({ start: "2026-09-17T02:00:00Z" })), "DENY"],
  ["fixture: extra field", fixReq(fixture({ winner: "a" })), "DENY"],
  ["fixture: empty team", fixReq(fixture({ team_a: "" })), "DENY"],
  ["fixture: bad id", fixReq(fixture(), undefined, FIX_PATH.replace(FIX_ID, "short")), "DENY"],
  ["fixture: reschedule", fixUpd(fixture(), fixture({ start: "2026-09-27T02:00:00Z", best_of: 3 })), "ALLOW"],
  ["fixture: rename team on update", fixUpd(fixture(), fixture({ team_a: "Other" })), "DENY"],
  ["fixture: change uploader on update", fixUpd(fixture(), fixture({ uid: "u2" })), "DENY"],
  ["fixture: delete (anyone signed in)", { request: { auth: { uid: "u2" }, method: "delete", path: FIX_PATH, time: NOW }, resource: { data: fixture() } }, "ALLOW"],
  ["fixture: signed-out delete", { request: { auth: null, method: "delete", path: FIX_PATH, time: NOW }, resource: { data: fixture() } }, "DENY"],
  ["edit: fix a player name", upd(match(), withPlayer(3, (p) => ({ ...p, name: "Fixed Name" }))), "ALLOW"],
  ["edit: worst case (long names + pick order)", upd(match(), { ...match(), players: match().players.map((p, i) => ({ ...p, name: "N".repeat(32), hero: "Vengeful Spirit", level: 30, hero_damage: 150000, tag: "TAG", pick: i + 1 })) }), "ALLOW"],
  ["edit: private result, rename team", upd(privateMatch(), privateMatch({ team_a: "Renamed" })), "ALLOW"],
  ["edit: unticketed, same series", upd(match({ series_id: 20690 }), match({ series_id: 20690, team_a: "Renamed" }), undefined, UNT_PATH), "ALLOW"],
  ["edit: signed out", upd(match(), match({ team_a: "Renamed" }), null), "DENY"],
  ["edit: change uploader", upd(match(), match({ uid: "u2" })), "DENY"],
  ["edit: change upload time", upd(match(), match({ createdAt: "2026-09-25T04:00:00Z" })), "DENY"],
  ["edit: public to private", upd(match(), privateMatch()), "DENY"],
  ["edit: change series", upd(match({ series_id: 20690 }), match({ series_id: 20691 }), undefined, UNT_PATH), "DENY"],
  ["edit: bad shape", upd(match(), match({ admin: true })), "DENY"],
  ["edit: level 99", upd(match(), withPlayer(3, (p) => ({ ...p, level: 99 }))), "DENY"],
  ["uploader deletes own unticketed game", { ...del(match(), { uid: "u1" }), request: { ...del(match(), { uid: "u1" }).request, path: PATH.replace("/matches/", "/ad2l_unticketed/") } }, "ALLOW"],
  // Heroic/Aegis: same rules in its own collection; picks with league "heroic".
  ["heroic: unticketed game", { ...req(match({ series_id: 20690 })), path: PATH.replace("/matches/", "/heroic_unticketed/") }, "ALLOW"],
  ["heroic: worst case (budget)", { ...req({ ...match({ series_id: 20690 }), players: match().players.map((p, i) => ({ ...p, name: "N".repeat(32), hero: "Vengeful Spirit", level: 30, hero_damage: 150000, tag: "TAG", pick: i + 1 })) }), path: PATH.replace("/matches/", "/heroic_unticketed/") }, "ALLOW"],
  ["heroic: unticketed without series_id", { ...req(match()), path: PATH.replace("/matches/", "/heroic_unticketed/") }, "DENY"],
  ["heroic: edit, same series", upd(match({ series_id: 20690 }), match({ series_id: 20690, team_a: "Renamed" }), undefined, PATH.replace("/matches/", "/heroic_unticketed/")), "ALLOW"],
  ["heroic: delete", { ...del(match(), { uid: "u1" }), request: { ...del(match(), { uid: "u1" }).request, path: PATH.replace("/matches/", "/heroic_unticketed/") } }, "ALLOW"],
  ["heroic: unknown collection still denied", { ...req(match({ series_id: 20690 })), path: PATH.replace("/matches/", "/aegis_unticketed/") }, "DENY"],
  ["prediction: heroic", predReq(pred({ league: "heroic" })), "ALLOW"],
  // Conqueror: same again.
  ["conqueror: unticketed game", { ...req(match({ series_id: 20690 })), path: PATH.replace("/matches/", "/conqueror_unticketed/") }, "ALLOW"],
  ["conqueror: unticketed without series_id", { ...req(match()), path: PATH.replace("/matches/", "/conqueror_unticketed/") }, "DENY"],
  ["conqueror: delete", { ...del(match(), { uid: "u1" }), request: { ...del(match(), { uid: "u1" }).request, path: PATH.replace("/matches/", "/conqueror_unticketed/") } }, "ALLOW"],
  ["prediction: conqueror", predReq(pred({ league: "conqueror" })), "ALLOW"],
  ["prediction: unknown league", predReq(pred({ league: "knight" })), "DENY"],
  ["prediction: heroic with a fixture id", { ...predReq(pred({ league: "heroic", series_id: FIX_ID })), path: SCRIM_PRED_PATH }, "DENY"],
];

(async () => {
  const acct = require("firebase-tools/lib/auth").getGlobalDefaultAccount();
  await requireAuth({ project: "pistachio-kitchen", user: acct.user, tokens: acct.tokens });
  const c = new Client({ urlPrefix: "https://firebaserules.googleapis.com", apiVersion: "v1" });
  const body = {
    source: { files: [{ name: "firestore.rules", content: source }] },
    testSuite: {
      testCases: cases.map(([, r, expectation]) => ({
        ...(r.request ? r : { request: r }), expectation, expressionReportLevel: "VISITED",
      })),
    },
  };
  const res = (await c.post("/projects/pistachio-kitchen:test", body)).body;
  for (const issue of res.issues ?? []) console.log("ISSUE:", issue.severity, issue.description, JSON.stringify(issue.sourcePosition));
  res.testResults?.forEach((r, i) => {
    console.log(`${r.state === "SUCCESS" ? "PASS" : "FAIL"}  ${cases[i][0]} (want ${cases[i][2]})`);
    if (r.state !== "SUCCESS") {
      console.log("   debug:", JSON.stringify(r.debugMessages ?? []).slice(0, 600));
      const falses = (r.visitedExpressions ?? []).filter((e) => e.value?.boolValue === false).slice(0, 12);
      for (const e of falses) console.log("   false at line", e.sourcePosition?.line, "col", e.sourcePosition?.column);
      if (r.errorPosition) console.log("   error at", JSON.stringify(r.errorPosition));
    }
  });
})().catch((e) => { console.error("FAILED:", e.message, JSON.stringify(e.context?.body ?? "").slice(0, 800)); process.exit(1); });
