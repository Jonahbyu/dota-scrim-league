// Small SVG charts, no library. Every chart is a <figure class="chart"> holding the SVG and a
// readout line; wireCharts() adds the hover crosshair (minute + values) from data-chart.
// Colours come from CSS classes (.s-a / .s-b / .s-ref …), so charts follow the theme.

const W = 800, H = 240, L = 52, R = 14, T = 16, B = 28;
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const k = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k` : String(Math.round(v)));
// Axis ticks keep the half thousand (12.5k, not 13k) so gridlines read true.
const tick = (v) => (v >= 1000 && v % 1000 ? `${(v / 1000).toFixed(1)}k` : k(v));
const niceMax = (v) => {
  if (v <= 0) return 1000;
  const step = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * step).find((m) => m >= v);
};
const xOf = (n) => (i) => L + (n > 1 ? i / (n - 1) : 0) * (W - L - R);
const path = (vals, x, y) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
const xTicks = (n, x, h = H) => {
  const step = n > 50 ? 10 : 5;
  let s = "";
  for (let m = 0; m < n; m += step) s += `<line class="grid" x1="${x(m)}" x2="${x(m)}" y1="${T}" y2="${h - B}"/><text class="tick" x="${x(m)}" y="${h - 8}" text-anchor="middle">${m}'</text>`;
  return s;
};

function figure(svg, data, caption, h = H) {
  return `<figure class="chart" data-chart="${attr(JSON.stringify(data))}">
    <svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${attr(caption)}">${svg}
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${h - B}" visibility="hidden"/><g class="hover-tags"></g></svg>
    <figcaption class="chart-read">${caption}</figcaption></figure>`;
}

// Team A's gold lead per minute as a two-colour area (A above zero, B below), XP lead as a
// dashed line, and a marker on each side's biggest lead.
// objectives: [{ type: "roshan" | "tormentor", time (s), side }] drawn as R / T markers,
// team A's along the top edge and team B's along the bottom.
// The lead axis fits the game: a 27k peak gets ±30k, not ±50k. Steps whose half is a clean
// gridline too (30k → 15k).
const leadMax = (v) => {
  if (v <= 0) return 1000;
  const step = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 3, 4, 5, 6, 8, 10].map((m) => m * step).find((m) => m >= v * 1.08);
};

export function leadChart(adv, { xp = null, nameA = "Team A", nameB = "Team B", id = "lead", objectives = null } = {}) {
  const n = adv.length;
  const max = leadMax(Math.max(...adv.map(Math.abs), ...(xp ?? []).map(Math.abs)));
  const x = xOf(n), y = (v) => T + (1 - (v + max) / (2 * max)) * (H - T - B), y0 = y(0);
  const area = `${path(adv, x, y)}L${x(n - 1)},${y0}L${x(0)},${y0}Z`;
  let grid = "";
  for (const v of [max, max / 2, -max / 2, -max]) grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v > 0 ? "+" : "−"}${tick(Math.abs(v))}</text>`;
  // Gold lead at a fractional minute, for objective stems.
  const at = (m) => { const i = Math.min(Math.max(m, 0), n - 1), a = Math.floor(i), b = Math.min(a + 1, n - 1); return adv[a] + (adv[b] - adv[a]) * (i - a); };
  // Objective markers ride the top (A) or bottom (B) edge; ones that would overlap step inward.
  const objs = (objectives ?? []).filter((o) => o.type === "roshan" || o.type === "tormentor").sort((p, q) => p.time - q.time);
  const lastX = { a: -Infinity, b: -Infinity }, lane = { a: 0, b: 0 };
  const markers = objs.map((o) => {
    const cx = L + Math.min(o.time / 60 / Math.max(n - 1, 1), 1) * (W - L - R);
    lane[o.side] = cx - lastX[o.side] < 18 ? (lane[o.side] + 1) % 3 : 0;
    lastX[o.side] = cx;
    const cy = o.side === "a" ? T + 12 + lane.a * 19 : H - B - 12 - lane.b * 19;
    return { o, cx, cy, ly: y(at(o.time / 60)) };
  });
  const peak = (sign) => {
    let best = 0, at = -1;
    adv.forEach((v, i) => { if (v * sign > best) { best = v * sign; at = i; } });
    if (at < 0 || best < 1000) return "";
    // Beside the dot, not above or below it: at a peak the line falls away on both sides, and
    // the objective markers along the edges stay clear. Flips left near the right edge.
    const left = x(at) > W - R - 90;
    return `<circle class="peak s-${sign > 0 ? "a" : "b"}" cx="${x(at)}" cy="${y(adv[at])}" r="4"/>
      <text class="peak-label s-${sign > 0 ? "a" : "b"}" x="${x(at) + (left ? -9 : 9)}" y="${y(adv[at]) + 4}" text-anchor="${left ? "end" : "start"}">${k(best)} @ ${at}'</text>`;
  };
  // Areas fade toward the zero line, so the size of a lead reads before its outline.
  const svg = `<defs>
      <clipPath id="${id}-up"><rect x="0" y="0" width="${W}" height="${y0}"/></clipPath>
      <clipPath id="${id}-down"><rect x="0" y="${y0}" width="${W}" height="${H - y0}"/></clipPath>
      <linearGradient id="${id}-fa" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${T}" y2="${y0}"><stop offset="0" stop-color="var(--jade)" stop-opacity=".42"/><stop offset="1" stop-color="var(--jade)" stop-opacity=".04"/></linearGradient>
      <linearGradient id="${id}-fb" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${y0}" y2="${H - B}"><stop offset="0" stop-color="var(--ember)" stop-opacity=".04"/><stop offset="1" stop-color="var(--ember)" stop-opacity=".42"/></linearGradient></defs>
    ${grid}${xTicks(n, x)}
    <text class="side-label s-a" x="${L + 8}" y="${T + 13}">${attr(nameA)} ahead</text>
    <text class="side-label s-b" x="${L + 8}" y="${H - B - 7}">${attr(nameB)} ahead</text>
    <path class="area" fill="url(#${id}-fa)" d="${area}" clip-path="url(#${id}-up)"/>
    <path class="area" fill="url(#${id}-fb)" d="${area}" clip-path="url(#${id}-down)"/>
    <line class="zero" x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}"/>
    ${markers.map(({ o, cx, cy, ly }) => `<line class="obj-stem s-${o.side}" x1="${cx}" x2="${cx}" y1="${cy + (o.side === "a" ? 8 : -8)}" y2="${ly}"/>`).join("")}
    ${xp ? `<path class="xp-line" d="${path(xp, x, y)}"/>` : ""}
    <path class="lead-line" d="${path(adv, x, y)}"/>
    ${markers.map(({ o, cx, ly }) => `<circle class="obj-dot s-${o.side}" cx="${cx}" cy="${ly}" r="2.5"/>`).join("")}
    ${peak(1)}${peak(-1)}
    ${markers.map(({ o, cx, cy }) => {
      const name = o.type === "roshan" ? "Roshan" : "Tormentor";
      return `<g class="obj s-${o.side}"><title>${name} — ${attr(o.side === "a" ? nameA : nameB)} at ${Math.floor(o.time / 60)}:${String(o.time % 60).padStart(2, "0")}</title>
        <circle cx="${cx}" cy="${cy}" r="8"/><text x="${cx}" y="${cy + 3.5}" text-anchor="middle">${o.type === "roshan" ? "R" : "T"}</text></g>`;
    }).join("")}`;
  return figure(svg, { kind: "lead", n, x: [L, W - R], nameA, nameB, series: [{ label: "Gold", values: adv }, ...(xp ? [{ label: "XP", values: xp }] : [])] },
    `Hover for the lead at any minute. Solid: gold lead${xp ? "; dashed: XP lead" : ""}${objectives?.length ? "; R = Roshan, T = Tormentor (top: " + attr(nameA) + ", bottom: " + attr(nameB) + ")" : ""}.`);
}

// Portrait tags (end labels and the hover column): hero art is 16:9, drawn 32×18 in a 2px frame
// of the line's colour, rows at least 23px apart.
const PW = 32, PH = 18, GAP = 23;
// items: [{ y }] → same items, y nudged apart (in order) and kept between top and bottom.
function stack(items, top, bottom) {
  const at = [...items].sort((a, b) => a.y - b.y);
  if (at.length) at[0].y = Math.max(at[0].y, top);
  for (let j = 1; j < at.length; j++) at[j].y = Math.max(at[j].y, at[j - 1].y + GAP);
  const over = at.length ? Math.max(0, at[at.length - 1].y - bottom) : 0; // pushed past the axis: shift all up
  for (const a of at) a.y -= over;
  return at;
}
const tag = (s, i, x0, cy, text, cls = "end-label") => `<g class="${cls} ${s.cls ?? ""}${s.dash ? " dash" : ""}" data-i="${i}"><title>${attr(s.label)}</title>
  <rect class="end-frame" x="${x0 - 1}" y="${(cy - PH / 2 - 1).toFixed(1)}" width="${PW + 2}" height="${PH + 2}"/>${s.img ? `<image href="${attr(s.img)}" x="${x0}" y="${(cy - PH / 2).toFixed(1)}" width="${PW}" height="${PH}" preserveAspectRatio="xMidYMid slice"/>` : ""}
  ${/flip/.test(cls) ? `<text x="${x0 - 6}" y="${(cy + 4).toFixed(1)}" text-anchor="end">` : `<text x="${x0 + PW + 7}" y="${(cy + 4).toFixed(1)}">`}${attr(text)}</text></g>`;

// Several lines on one 0-based axis (gold over time). series: { label, values, cls, dash?, strong?,
// end?, img? }. endLabels: at the right end of each line, the series' `img` (a hero portrait)
// framed in the line's colour and its `end` text (or label); hovering then shows the same
// portraits with each value up the crosshair. height: taller plot when there are many labels.
export function lineChart(series, { caption = "Hover for values at any minute.", id = "lines", max: fixed = null, endLabels = false, height = H } = {}) {
  const n = Math.max(...series.map((s) => s.values.length));
  const max = fixed ?? niceMax(Math.max(...series.flatMap((s) => s.values)));
  const r = endLabels ? 168 : R, h = height;
  const x = (i) => L + (n > 1 ? i / (n - 1) : 0) * (W - L - r), y = (v) => T + (1 - v / max) * (h - T - B);
  let grid = "";
  for (const v of [max, max * 0.75, max / 2, max / 4]) grid += `<line class="grid" x1="${L}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${tick(v)}</text>`;
  const lines = series.map((s, i) => `<path class="line ${s.cls ?? ""}${s.dash ? " dash" : ""}${s.strong ? " strong" : ""}" data-i="${i}" d="${path(s.values, x, y)}"><title>${attr(s.label)}</title></path>`).join("");
  const cut = (t) => (t.length > 16 ? `${t.slice(0, 15)}…` : t);
  const ends = endLabels
    ? stack(series.map((s, i) => ({ i, s, y: y(s.values[s.values.length - 1] ?? 0) })), T + PH / 2, h - B - PH / 2)
      .map(({ i, s, y: cy }) => tag(s, i, W - r + 10, cy, cut(s.end ?? s.label))).join("")
    : "";
  const svg = `${grid}${xTicks(n, x, h)}<line class="zero" x1="${L}" x2="${W - r}" y1="${y(0)}" y2="${y(0)}"/>${lines}${ends}`;
  const legend = `<div class="chart-legend">${series.map((s, i) => `<span class="lg-item ${s.cls ?? ""}${s.dash ? " dash" : ""}" data-i="${i}"><i></i>${attr(s.label)}</span>`).join("")}</div>`;
  const data = { kind: "lines", n, x: [L, W - r], y: [T, h - B], max, tags: endLabels,
    series: series.map((s) => ({ label: s.label, values: s.values, ...(endLabels ? { img: s.img, cls: s.cls, dash: s.dash } : {}) })) };
  return figure(svg, data, caption, h).replace("</figure>", `${legend}</figure>`);
}

// Hover crosshair + readout for every chart under root.
export function wireCharts(root) {
  root.querySelectorAll("figure.chart[data-chart]").forEach((fig) => {
    const d = JSON.parse(fig.dataset.chart);
    const svg = fig.querySelector("svg"), cross = fig.querySelector(".cross"), read = fig.querySelector(".chart-read"), tags = fig.querySelector(".hover-tags");
    const idle = read.innerHTML;
    const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±");
    const at = (e) => {
      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * W;
      const i = Math.round(((vx - d.x[0]) / (d.x[1] - d.x[0])) * (d.n - 1));
      return Math.max(0, Math.min(d.n - 1, i));
    };
    svg.addEventListener("pointermove", (e) => {
      const i = at(e);
      const cx = d.x[0] + (d.n > 1 ? i / (d.n - 1) : 0) * (d.x[1] - d.x[0]);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
      if (d.kind === "lead") {
        read.innerHTML = `<b>${i}'</b> ${d.series.map((s) => {
          const v = s.values[i];
          if (v == null) return "";
          const who = v > 0 ? d.nameA : v < 0 ? d.nameB : "even";
          return `<span>${s.label}: <b class="${v > 0 ? "s-a" : v < 0 ? "s-b" : ""}">${sign(v)}${k(Math.abs(v))}</b> ${v ? attr(who) : ""}</span>`;
        }).join(" · ")}`;
      } else {
        const rows = d.series.map((s) => [s.label, s.values[i]]).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
        read.innerHTML = `<b>${i}'</b> ${rows.map(([l, v]) => `<span>${attr(l)} <b>${k(v)}</b></span>`).join(" · ")}`;
        if (d.tags) {
          // Up the crosshair: a dot on each line, and its portrait + value beside it (left of the
          // line once it's past the middle, so the column stays inside the plot).
          const yv = (v) => d.y[0] + (1 - v / d.max) * (d.y[1] - d.y[0]);
          const live = d.series.map((s, j) => ({ i: j, s, v: s.values[i] })).filter((t) => t.v != null).map((t) => ({ ...t, y: yv(t.v), dot: yv(t.v) }));
          const left = cx > (d.x[0] + d.x[1]) / 2, x0 = left ? cx - 12 - PW : cx + 12;
          // Ten portraits need more height than the values span, so each gets a leader from its dot.
          const placed = stack(live, d.y[0] + PH / 2, d.y[1] - PH / 2), ex = left ? cx - 10 : cx + 10;
          tags.innerHTML = placed.map((t) => `<path class="hover-lead ${t.s.cls ?? ""}" d="M${cx},${t.dot.toFixed(1)}L${ex},${t.y.toFixed(1)}"/>`).join("") +
            live.map((t) => `<circle class="hover-dot ${t.s.cls ?? ""}" cx="${cx}" cy="${t.dot.toFixed(1)}" r="3"/>`).join("") +
            placed.map((t) => tag(t.s, t.i, x0, t.y, t.v >= 1000 ? `${(t.v / 1000).toFixed(1)}k` : String(t.v), `hover-tag${left ? " flip" : ""}`)).join("");
        }
      }
    });
    svg.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); read.innerHTML = idle; tags.innerHTML = ""; });
    // Legend hover highlights one line.
    fig.querySelectorAll(".lg-item").forEach((it) => {
      it.onmouseenter = () => {
        fig.classList.add("focus");
        fig.querySelectorAll(`svg [data-i="${it.dataset.i}"]`).forEach((el) => el.classList.add("on"));
      };
      it.onmouseleave = () => { fig.classList.remove("focus"); fig.querySelectorAll(".on").forEach((p) => p.classList.remove("on")); };
    });
  });
}
