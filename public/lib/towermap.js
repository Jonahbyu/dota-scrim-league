// Tower maps from parsed replays (AD2L). Each game carries `buildings`: every tower, barracks
// and Ancient that fell, with the second it fell and the side that took it.
//
// buildingsFrom() turns OpenDota's building_kill objectives into that list (used by the sync).
// towerMapHtml() returns a <figure> showing which buildings stand at the end of a game phase,
// what fell in it and when; wireTowerMaps() draws it and wires the phase control.

// Same minimap placement and grid as the ward map (see wardmap.js).
const IMG = { src: "img/minimap.webp", x0: 56.94, x1: 206.2, y0: 62.3, y1: 202.8 };
const CX = (74.6 + 182.9) / 2, CY = (78.0 + 177.9) / 2;
const Y = (y) => 256 - y;
const VB = { x: IMG.x0, y: Y(IMG.y1), w: IMG.x1 - IMG.x0, h: IMG.y1 - IMG.y0 };
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// OpenDota building key → { side, b }. side = owner ("a" Radiant, "b" Dire); b = "t1_top",
// "t4", "melee_mid", "range_bot", "fort".
export function parseBuilding(key) {
  const m = /^npc_dota_(good|bad)guys_(?:tower([1-4])(?:_(top|mid|bot))?|(melee|range)_rax_(top|mid|bot)|(fort))$/.exec(key ?? "");
  if (!m) return null;
  const side = m[1] === "good" ? "a" : "b";
  const b = m[2] ? (m[2] === "4" ? "t4" : `t${m[2]}_${m[3]}`) : m[4] ? `${m[4]}_${m[5]}` : "fort";
  return { side, b };
}

// OpenDota objectives → [{ side, b, time, by, hero }], in the order they fell. by = side that
// got the kill (a hero's team, or the creeps' colour; null if unknown), so by === side is a deny.
// heroOf(player_slot) names the hero that took it, if a hero did.
export function buildingsFrom(objectives, heroOf = () => null) {
  if (!Array.isArray(objectives)) return null;
  return objectives.filter((o) => o.type === "building_kill").flatMap((o) => {
    const k = parseBuilding(o.key);
    if (!k) return [];
    const by = o.player_slot != null ? (o.player_slot < 128 ? "a" : "b")
      : /goodguys/.test(o.unit ?? "") ? "a" : /badguys/.test(o.unit ?? "") ? "b" : null;
    return [{ ...k, time: o.time, by, hero: o.player_slot != null ? heroOf(o.player_slot) ?? null : null }];
  }).sort((x, y) => x.time - y.time);
}

// Radiant building spots on the grid, placed by hand on the minimap along each lane (a grid
// unit or two out at most; there is no position data in the replay summary). Dire's are the
// point mirror: Dire's top lane mirrors Radiant's bottom lane.
const RAD = {
  t1_top: [79.2, 142.5], t2_top: [80.0, 121.4], t3_top: [76.8, 100.7],
  t1_mid: [116.0, 117.3], t2_mid: [100.3, 106.1], t3_mid: [91.7, 96.8],
  t1_bot: [166.3, 80.7], t2_bot: [125.3, 79.2], t3_bot: [97.1, 80.3],
  t4: [[83.5, 90.1], [85.8, 87.4]], fort: [81.9, 86.2],
};
// Barracks: a pair just behind each tier 3, across the lane from each other.
for (const lane of ["top", "mid", "bot"]) {
  const [tx, ty] = RAD[`t3_${lane}`], [fx, fy] = RAD.fort;
  const d = Math.hypot(fx - tx, fy - ty), ux = (fx - tx) / d, uy = (fy - ty) / d;
  const bx = tx + ux * 3.6, by = ty + uy * 3.6;
  RAD[`melee_${lane}`] = [bx - uy * 1.7, by + ux * 1.7];
  RAD[`range_${lane}`] = [bx + uy * 1.7, by - ux * 1.7];
}
const MIRROR_LANE = { top: "bot", mid: "mid", bot: "top" };
function spot(side, b, n = 0) {
  const lane = b.split("_")[1];
  const key = side === "b" && lane ? b.replace(lane, MIRROR_LANE[lane]) : b;
  const p = b === "t4" ? RAD.t4[n] : RAD[key];
  return side === "a" ? p : [+(2 * CX - p[0]).toFixed(1), +(2 * CY - p[1]).toFixed(1)];
}
const ALL = ["t1_top", "t2_top", "t3_top", "t1_mid", "t2_mid", "t3_mid", "t1_bot", "t2_bot", "t3_bot",
  "melee_top", "range_top", "melee_mid", "range_mid", "melee_bot", "range_bot", "t4", "t4", "fort"];
const NAME = (b) => b === "fort" ? "Ancient" : b === "t4" ? "Tier 4"
  : b.startsWith("t") ? `T${b[1]} ${b.slice(3)}` : `${b[0].toUpperCase()}${b.slice(1).replace("_", " rax ")}`;
const isTower = (b) => b.startsWith("t");

const PHASES = [["0", "0–10'", 0, 600], ["1", "10–20'", 600, 1200], ["2", "20–35'", 1200, 2100], ["3", "35'+", 2100, Infinity]];

// m: an AD2L game with `buildings`. Empty string when the game has none (unparsed replay).
export function towerMapHtml(m, { id = "towers" } = {}) {
  if (!Array.isArray(m.buildings) || !m.buildings.length) return "";
  const data = { a: m.team_a, b: m.team_b, dur: m.duration_sec, fell: m.buildings.map((x) => [x.side, x.b, x.time, x.by, x.hero]) };
  const phases = PHASES.filter(([, , from]) => from < m.duration_sec);
  const seg = `<div class="wm-seg" role="group" data-ctl="phase">${[["all", "Whole game"], ...phases].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === "all"}">${l}</button>`).join("")}</div>`;
  return `<figure class="wardmap towermap" id="${id}" data-phase="all" data-buildings="${attr(JSON.stringify(data))}">
    <div class="wm-controls">${seg}</div>
    <div class="wm-body"><div class="wm-map"></div><div class="wm-side"></div></div>
  </figure>`;
}

function draw(fig) {
  const d = JSON.parse(fig.dataset.buildings);
  const ph = PHASES.find(([v]) => v === fig.dataset.phase);
  // The Ancient can fall a second after the recorded duration.
  const end = Math.max(d.dur, ...d.fell.map((f) => f[2]));
  const from = ph ? ph[2] : 0, to = ph ? Math.min(ph[3], end) : end;
  const team = { a: d.a, b: d.b };
  // Each building slot, with when it fell (if it did). The two tier 4s fill in kill order.
  const slots = [];
  for (const side of ["a", "b"]) {
    const fell = d.fell.filter((f) => f[0] === side);
    let t4 = 0;
    for (const b of ALL) {
      const n = b === "t4" ? t4++ : 0;
      const f = fell.filter((x) => x[1] === b)[n] ?? null;
      slots.push({ side, b, pos: spot(side, b, n), f });
    }
  }
  const state = (s) => !s.f || s.f[2] > to ? "up" : s.f[2] >= from ? "new" : "old";
  const tip = (s) => {
    const who = `${team[s.side]} ${NAME(s.b)}`;
    if (!s.f) return `${who}: standing at the end`;
    const [, , t, by, hero] = s.f;
    const how = by === s.side ? "denied" : hero ? `taken by ${hero}` : by ? "taken by creeps" : "destroyed";
    return state(s) === "up" ? `${who}: standing at ${clock(to)}; ${how} at ${clock(t)}` : `${who}: ${how} at ${clock(t)}`;
  };
  const mark = (s) => {
    const [x, gy] = s.pos, y = Y(gy), st = state(s), r = s.b === "fort" ? 2.4 : isTower(s.b) ? 1.7 : 1.1;
    const shape = isTower(s.b) || s.b === "fort"
      ? `<circle cx="${x}" cy="${y}" r="${r}"/>`
      : `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}"/>`;
    const cross = st === "up" ? "" : `<path class="tm-x" d="M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}"/>`;
    return `<g class="tm-b s-${s.side} ${st}"><title>${attr(tip(s))}</title>${shape}${cross}</g>`;
  };
  // Time labels on towers that fell in the window shown (whole game: all of them), drawn last
  // so base buildings don't cover them.
  const label = (s) => state(s) === "new" && isTower(s.b) && s.b !== "t4"
    ? `<text class="tm-t" x="${s.pos[0]}" y="${Y(s.pos[1]) - 2.9}" text-anchor="middle">${clock(s.f[2])}</text>` : "";
  // Standing ones last so they sit on top where the base gets crowded.
  const order = [...slots].sort((p, q) => (state(p) === "up") - (state(q) === "up"));
  fig.querySelector(".wm-map").innerHTML = `<svg viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" role="img" aria-label="Tower map at ${clock(to)}">
    <image href="${IMG.src}" x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" preserveAspectRatio="none"/>
    <rect class="wm-dim" x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}"/>
    <text class="wm-lbl a" x="${VB.x + 3}" y="${VB.y + VB.h - 3}">${attr(d.a)}</text>
    <text class="wm-lbl b" x="${VB.x + VB.w - 3}" y="${VB.y + 7}" text-anchor="end">${attr(d.b)}</text>
    ${order.map(mark).join("")}${slots.map(label).join("")}</svg>`;

  // Side panel: what's standing at the end of the window, then what fell in it.
  const side = (s) => {
    const mine = slots.filter((x) => x.side === s);
    const up = (f) => mine.filter((x) => f(x.b) && state(x) === "up").length;
    const lost = mine.filter((x) => state(x) === "new").sort((p, q) => p.f[2] - q.f[2]);
    return `<div class="wm-stat s-${s}"><div class="wm-who">${attr(team[s])}</div>
      <div><b>${up((b) => isTower(b))}</b>/11 towers · <b>${up((b) => !isTower(b) && b !== "fort")}</b>/6 barracks standing at ${clock(to)}</div>
      ${lost.length ? `<ul class="tm-list">${lost.map((x) => `<li><b>${clock(x.f[2])}</b> ${NAME(x.b)}${x.f[3] === s ? " <span class=\"muted\">(denied)</span>" : ""}</li>`).join("")}</ul>`
        : `<div class="muted">Lost nothing${ph ? " in this phase" : ""}</div>`}</div>`;
  };
  fig.querySelector(".wm-side").innerHTML = side("a") + side("b") +
    `<p class="wm-note">Map at ${clock(to)}${ph ? `, end of ${ph[1]}` : ", end of game"}. ● tower, ■ barracks; ✕ = fallen (bright: ${ph ? "in this phase" : "during the game"}, faded: earlier). Hover a building for when and who.</p>`;
}

export function wireTowerMaps(root) {
  root.querySelectorAll("figure.towermap[data-buildings]").forEach((fig) => {
    draw(fig);
    fig.querySelectorAll(".wm-seg").forEach((seg) => seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      fig.dataset[seg.dataset.ctl] = b.dataset.v;
      seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      draw(fig);
    }));
  });
}
