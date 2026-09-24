// Firestore access. Matches live at scrimLeague/data/matches/{matchId} in the shared
// pistachio-kitchen project (rules: firebase/scrimleague.rules). Uploading signs in
// anonymously; reading needs no sign-in. The anonymous session persists in this browser,
// which is what lets an uploader delete their own scrim later.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, orderBy, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { FIREBASE_CONFIG } from "../firebase-config.js";
import { matchId } from "./stats.js";
import { parseDuration } from "./validate.js";

const app = initializeApp(FIREBASE_CONFIG, "scrim-league");
const auth = getAuth(app);
const db = getFirestore(app);
// Scrims in `matches`; AD2L division games played without a league ticket, uploaded from
// screenshots the same way, in `ad2l_unticketed`. Same document shape and rules for both.
const COLLECTIONS = { scrim: "matches", ad2l: "ad2l_unticketed" };
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
  const data = toStored(draft, { isPrivate, seriesId: league === "ad2l" ? seriesId : null });
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

// The league admin signs in with their email account (same project login as Cookbook) on
// a second Firebase app instance, so it doesn't replace this browser's anonymous session,
// which is what owns this browser's uploads and predictions. The rules check the email.
const ADMIN_EMAIL = "jonahbyu@gmail.com";
const adminAuth = getAuth(initializeApp(FIREBASE_CONFIG, "scrim-league-admin"));
const adminDb = getFirestore(adminAuth.app);
const adminReady = new Promise((resolve) => { const off = onAuthStateChanged(adminAuth, () => { off(); resolve(); }); });
export async function isAdmin() {
  await adminReady;
  return adminAuth.currentUser?.email === ADMIN_EMAIL;
}
export async function adminSignIn(email, password) {
  await signInWithEmailAndPassword(adminAuth, email.trim(), password);
  if (adminAuth.currentUser?.email !== ADMIN_EMAIL) { await signOut(adminAuth); throw new Error("That account isn't the league admin."); }
}
export const adminSignOut = () => signOut(adminAuth);

// Only the uploader (same browser session) or the league admin may delete; the rules
// enforce it, this just makes the call (as the admin when signed in as one).
export async function deleteMatch(id, league = "scrim") {
  const asAdmin = await isAdmin();
  await deleteDoc(doc(asAdmin ? adminDb : db, "scrimLeague", "data", COLLECTIONS[league], id));
}

// Put an unticketed upload in a PlayOn series (or take it out with null). Saved games are
// create-only, so this deletes the upload and saves it again with the new series_id, same
// ID (the ID doesn't depend on the series). Uploader or admin only, like delete. If saving
// fails, the original is put back.
export async function moveMatch(id, seriesId, league = "ad2l") {
  const asAdmin = await isAdmin();
  const ref = doc(asAdmin ? adminDb : db, "scrimLeague", "data", COLLECTIONS[league], id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That game isn't there any more.");
  const { uid, createdAt, series_id, ...rest } = snap.data();
  await deleteDoc(ref);
  await authReady;
  if (!auth.currentUser) await signInAnonymously(auth);
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

export async function savePrediction(seriesId, pick, name) {
  await authReady;
  if (!auth.currentUser) await signInAnonymously(auth);
  const uid = auth.currentUser.uid;
  await setDoc(doc(predictions, `${seriesId}_${uid}`), {
    v: 1, league: "ad2l", series_id: seriesId, pick, name: name.trim().slice(0, 24), uid, updatedAt: serverTimestamp(),
  });
  return uid;
}
