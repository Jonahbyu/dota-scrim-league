// Firestore access. Matches live at scrimLeague/data/matches/{matchId} in the shared
// pistachio-kitchen project (rules: firebase/scrimleague.rules). Uploading signs in
// anonymously; reading needs no sign-in. The anonymous session persists in this browser,
// which is what lets an uploader delete their own scrim later.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, orderBy, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { FIREBASE_CONFIG } from "../firebase-config.js";
import { matchId } from "./stats.js";
import { parseDuration } from "./validate.js";

const app = initializeApp(FIREBASE_CONFIG, "scrim-league");
const auth = getAuth(app);
const db = getFirestore(app);
const matches = collection(db, "scrimLeague", "data", "matches");

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
export async function submitMatch(draft, { isPrivate = false } = {}) {
  const data = toStored(draft, { isPrivate });
  const id = await matchId(data);
  const ref = doc(matches, id);
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

// Only the uploader (same browser session) or the league admin may delete; the rules
// enforce it, this just makes the call.
export async function deleteMatch(id) {
  await deleteDoc(doc(matches, id));
}

const fromDoc = (d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() ?? null });

export async function listMatches() {
  const snap = await getDocs(query(matches, orderBy("createdAt", "desc"), limit(MAX_MATCHES)));
  return snap.docs.map(fromDoc);
}

export async function getMatch(id) {
  const d = await getDoc(doc(matches, id));
  return d.exists() ? fromDoc(d) : null;
}
