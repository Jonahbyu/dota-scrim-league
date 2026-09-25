// Firestore access. Matches live at scrimLeague/data/matches/{matchId} in the shared
// pistachio-kitchen project (rules: firebase/scrimleague.rules). Uploading signs in
// anonymously; reading needs no sign-in. The anonymous session persists in this browser,
// which is what lets an uploader delete their own scrim later.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, orderBy, limit, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { FIREBASE_CONFIG } from "../firebase-config.js";
import { matchId } from "./stats.js";
import { parseDuration } from "./validate.js";

const app = initializeApp(FIREBASE_CONFIG, "scrim-league");
const auth = getAuth(app);
const db = getFirestore(app);
// Scrims in `matches`; AD2L division games played without a league ticket, uploaded from
// screenshots the same way, in `ad2l_unticketed` (Champion) and `heroic_unticketed`
// (Heroic/Aegis). Same document shape and rules for all three.
const COLLECTIONS = { scrim: "matches", ad2l: "ad2l_unticketed", heroic: "heroic_unticketed" };
const coll = (league = "scrim") => collection(db, "scrimLeague", "data", COLLECTIONS[league]);

export const MAX_MATCHES = 500;

// Resolves once Firebase has restored any saved session from this browser.
const authReady = new Promise((resolve) => { const off = onAuthStateChanged(auth, () => { off(); resolve(); }); });
export async function currentUid() {
  await authReady;
  return auth.currentUser?.uid ?? null;
}

// Review-form draft → the stored document shape the rules validate.
// Private = results only: heroes, players and stats are never sent anywhere.
// seriesId: the PlayOn series an unticketed AD2L game fills (only that collection allows it).
export function toStored(draft, { isPrivate = false, seriesId = null } = {}) {
  const base = {
    ...(Number.isInteger(seriesId) ? { series_id: seriesId } : {}),
    v: 2,
    private: isPrivate,
    team_a: draft.team_a.trim(),
    team_b: draft.team_b.trim(),
    score_a: draft.score_a,
    score_b: draft.score_b,
    winner: draft.winner,
    duration_sec: parseDuration(draft.duration),
    game_mode: (draft.game_mode ?? "").trim(),
  };
  if (isPrivate) return base;
  // Saved only as a complete 1–10 set (the rules accept pick on all players or none).
  const picks = draft.players.map((p) => p.pick);
  const fullPicks = picks.every((v) => Number.isInteger(v) && v >= 1 && v <= 10) && new Set(picks).size === 10;
  return {
    ...base,
    players: draft.players.map((p) => ({
      team: p.team,
      name: p.name.trim(),
      tag: p.tag?.trim() || null,
      hero: p.hero,
      level: p.level, kills: p.kills, deaths: p.deaths, assists: p.assists,
      net_worth: p.net_worth, last_hits: p.last_hits, denies: p.denies,
      gpm: p.gpm, xpm: p.xpm, hero_damage: p.hero_damage, hero_healing: p.hero_healing,
      ...(fullPicks ? { pick: p.pick } : {}),
    })),
  };
}

// Returns { id } on success or { duplicateOf: id } if the game is already uploaded.
export async function submitMatch(draft, { isPrivate = false, league = "scrim", seriesId = null } = {}) {
  const data = toStored(draft, { isPrivate, seriesId: league !== "scrim" ? seriesId : null });
  const id = await matchId(data);
  const ref = doc(coll(league), id);
  if ((await getDoc(ref)).exists()) return { duplicateOf: id };
  await authReady;
  if (!auth.currentUser) await signInAnonymously(auth);
  try {
    await setDoc(ref, { ...data, uid: auth.currentUser.uid, createdAt: serverTimestamp() });
  } catch (e) {
    // Create-only rules: if someone saved the same game a moment ago this becomes a
    // denied update.
    if (e.code === "permission-denied" && (await getDoc(ref)).exists()) return { duplicateOf: id };
    throw e;
  }
  return { id };
}

// Any signed-in visitor may delete an upload (the rules allow it); the site asks for the
// league's shared password first. Signs in anonymously if this browser hasn't yet.
async function signedIn() {
  await authReady;
  if (!auth.currentUser) await signInAnonymously(auth);
}
export async function deleteMatch(id, league = "scrim") {
  await signedIn();
  await deleteDoc(doc(coll(league), id));
}

// Save corrections to an upload in place: same ID, uploader, upload time, private flag and
// series (the rules check all of that). Behind the same password as delete.
export async function editMatch(id, draft, league = "scrim") {
  await signedIn();
  const ref = doc(coll(league), id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That game isn't there any more.");
  const { uid, createdAt, series_id, private: isPrivate } = snap.data();
  await setDoc(ref, { ...toStored(draft, { isPrivate, seriesId: series_id ?? null }), uid, createdAt });
}

// Put an unticketed upload in a PlayOn series (or take it out with null). Saved games are
// create-only, so this deletes the upload and saves it again with the new series_id, same
// ID (the ID doesn't depend on the series). Behind the same password as delete. If saving
// fails, the original is put back.
export async function moveMatch(id, seriesId, league = "ad2l") {
  await signedIn();
  const ref = doc(coll(league), id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That game isn't there any more.");
  const { uid, createdAt, series_id, ...rest } = snap.data();
  await deleteDoc(ref);
  const save = (data) => setDoc(doc(coll(league), id), { ...data, uid: auth.currentUser.uid, createdAt: serverTimestamp() });
  try {
    await save(Number.isInteger(seriesId) ? { ...rest, series_id: seriesId } : rest);
  } catch (e) {
    await save(Number.isInteger(series_id) ? { ...rest, series_id } : rest).catch(() => {});
    throw e;
  }
}

const fromDoc = (d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() ?? null });

export async function listMatches(league = "scrim") {
  const snap = await getDocs(query(coll(league), orderBy("createdAt", "desc"), limit(MAX_MATCHES)));
  return snap.docs.map(fromDoc);
}

export async function getMatch(id, league = "scrim") {
  const d = await getDoc(doc(coll(league), id));
  return d.exists() ? fromDoc(d) : null;
}

// ---------- predictions ----------
// One document per browser per series (id "<series>_<uid>"); saving again changes the pick.
// updatedAt is the server's clock, which is what scoring checks against the series start.
const predictions = collection(db, "scrimLeague", "data", "predictions");

export async function listPredictions() {
  const snap = await getDocs(query(predictions, limit(5000)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), updatedAt: d.data().updatedAt?.toDate?.() ?? null }));
}

// league "ad2l" (Champion) or "heroic": seriesId is a PlayOn series (number); "scrim": a
// fixture's document ID.
export async function savePrediction(seriesId, pick, name, league = "ad2l") {
  await signedIn();
  const uid = auth.currentUser.uid;
  await setDoc(doc(predictions, `${seriesId}_${uid}`), {
    v: 1, league, series_id: seriesId, pick, name: name.trim().slice(0, 24), uid, updatedAt: serverTimestamp(),
  });
  return uid;
}

// ---------- scrim fixtures ----------
// Upcoming scrims anyone can put on the schedule: two team names, a start time and the
// format. Results aren't stored here; uploaded games settle a fixture (lib/fixtures.js).
const fixtures = collection(db, "scrimLeague", "data", "scrim_fixtures");
const fixtureFromDoc = (d) => ({ id: d.id, ...d.data(), start: d.data().start?.toDate?.() ?? null, createdAt: d.data().createdAt?.toDate?.() ?? null });

export async function listFixtures() {
  const snap = await getDocs(query(fixtures, orderBy("start", "desc"), limit(MAX_MATCHES)));
  return snap.docs.map(fixtureFromDoc);
}

export async function addFixture({ team_a, team_b, start, best_of }) {
  await signedIn();
  const ref = doc(fixtures); // random 20-character ID
  await setDoc(ref, {
    v: 1, team_a: team_a.trim(), team_b: team_b.trim(), start: Timestamp.fromDate(start), best_of,
    uid: auth.currentUser.uid, createdAt: serverTimestamp(),
  });
  return ref.id;
}

// Reschedule: only the start time and format can change.
export async function moveFixture(id, start, best_of) {
  await signedIn();
  await updateDoc(doc(fixtures, id), { start: Timestamp.fromDate(start), best_of });
}

export async function deleteFixture(id) {
  await signedIn();
  await deleteDoc(doc(fixtures, id));
}
