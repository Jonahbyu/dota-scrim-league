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
export function toStored(draft, { isPrivate = false } = {}) {
  const base = {
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
    })),
  };
}

// Returns { id } on success or { duplicateOf: id } if the game is already uploaded.
export async function submitMatch(draft, { isPrivate = false, league = "scrim" } = {}) {
  const data = toStored(draft, { isPrivate });
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
