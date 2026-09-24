// Live test of the scrimLeague Firestore rules, as an anonymous user via the REST API.
// Writes one fake match (id 000…001) — delete it afterwards with:
//   npx firebase firestore:delete scrimLeague/data/matches/00000000000000000000000000000001 --project pistachio-kitchen -f
import { FIREBASE_CONFIG } from "../public/firebase-config.js";

const KEY = FIREBASE_CONFIG.apiKey;
const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const COL = "scrimLeague/data/matches";
const TEST_ID = "00000000000000000000000000000001";

async function anonToken() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error("anonymous sign-in failed: " + JSON.stringify(j));
  return { token: j.idToken, uid: j.localId };
}

// JS value → Firestore REST value.
const val = (v) => {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === "number") return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(val) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
};

function fakeMatch(uid) {
  const player = (i) => ({
    team: i < 5 ? "a" : "b", name: `Rules Test Player ${i + 1}`, tag: null, hero: "Kez",
    level: 20, kills: 2, deaths: 2, assists: 5, net_worth: 15000, last_hits: 200, denies: 5,
    gpm: 450, xpm: 600, hero_damage: 15000, hero_healing: 0,
  });
  return { v: 1, team_a: "Rules Test A", team_b: "Rules Test B", score_a: 10, score_b: 10, winner: "a",
    duration_sec: 2400, game_mode: "Captains Mode", players: [...Array(10)].map((_, i) => player(i)), uid };
}

// Create via commit so createdAt can be the server's REQUEST_TIME, like serverTimestamp().
async function create(auth, id, data, { serverTime = true, mustNotExist = true } = {}) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, val(v)]));
  const write = { update: { name: `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${COL}/${id}`, fields } };
  if (serverTime) write.updateTransforms = [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }];
  if (mustNotExist) write.currentDocument = { exists: false };
  const r = await fetch(`${BASE}:commit`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth.token}` } : {}) },
    body: JSON.stringify({ writes: [write] }),
  });
  if (process.env.VERBOSE && r.status !== 200) console.log("   ", (await r.text()).slice(0, 400).replace(/\s+/g, " "));
  return r.status;
}

const results = [];
const expect = (label, status, want) => {
  const ok = want === "allow" ? status === 200 : status === 403;
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: HTTP ${status} (want ${want})`);
};

const me = await anonToken();
const other = await anonToken();

expect("valid match, anonymous user", await create(me, TEST_ID, fakeMatch(me.uid)), "allow");
expect("same id again (update)", await create(me, TEST_ID, fakeMatch(me.uid), { mustNotExist: false }), "deny");
expect("no sign-in", await create(null, "00000000000000000000000000000002", fakeMatch("x")), "deny");
expect("uid of someone else", await create(me, "00000000000000000000000000000003", fakeMatch(other.uid)), "deny");
expect("bad id format", await create(me, "not-a-hash", fakeMatch(me.uid)), "deny");
expect("client-supplied createdAt", await create(me, "00000000000000000000000000000004", { ...fakeMatch(me.uid), createdAt: "2020-01-01" }, { serverTime: false }), "deny");
{ const m = fakeMatch(me.uid); m.players = m.players.slice(0, 9); expect("only 9 players", await create(me, "00000000000000000000000000000005", m), "deny"); }
{ const m = fakeMatch(me.uid); m.players[3].level = 99; expect("level 99", await create(me, "00000000000000000000000000000006", m), "deny"); }
{ const m = fakeMatch(me.uid); m.players[6].team = "a"; expect("team B slot marked team A", await create(me, "00000000000000000000000000000007", m), "deny"); }
{ const m = fakeMatch(me.uid); m.admin = true; expect("extra field", await create(me, "00000000000000000000000000000008", m), "deny"); }
{ const m = fakeMatch(me.uid); m.players[0].kills = "9"; expect("number as string", await create(me, "00000000000000000000000000000009", m), "deny"); }
{ const m = fakeMatch(me.uid); m.team_b = "rules test a"; expect("same team twice", await create(me, "0000000000000000000000000000000a", m), "deny"); }

// Reads
let r = await fetch(`${BASE}/${COL}/${TEST_ID}`);
expect("public get", r.status, "allow");
const list = (n) => fetch(`${BASE}:runQuery`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "matches" }], limit: n } }) });
r = await fetch(`${BASE}/scrimLeague/data:runQuery`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "matches" }], limit: 10 } }) });
expect("public list, limit 10", r.status, "allow");
r = await fetch(`${BASE}/scrimLeague/data:runQuery`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "matches" }], limit: 501 } }) });
expect("public list, limit 501", r.status, "deny");

// Delete as a non-admin
r = await fetch(`${BASE}/${COL}/${TEST_ID}`, { method: "DELETE", headers: { authorization: `Bearer ${me.token}` } });
expect("anonymous delete", r.status, "deny");

console.log(`\n${results.filter(Boolean).length}/${results.length} rule checks passed`);
void list;
