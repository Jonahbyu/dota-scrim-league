// Small SVG charts, no library. Every chart is a <figure class="chart"> holding the SVG and a
// readout line; wireCharts() adds the hover crosshair (minute + values) from data-chart.
// Colours come from CSS classes (.s-a / .s-b / .s-ref …), so charts follow the theme.

const W = 800, H = 240, L = 52, R = 14, T = 16, B = 28;
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const k = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k` : String(Math.round(v)));
const niceMax = (v) => {
  if (v <= 0) return 1000;
  const step = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * step).find((m) => m >= v);
};
const xOf = (n) => (i) => L + (n > 1 ? i / (n - 1) : 0) * (W - L - R);
const path = (vals, x, y) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
const xTicks = (n, x) => {
  const step = n > 50 ? 10 : 5;
  let s = "";
  for (let m = 0; m < n; m += step) s += `<line class="grid" x1="${x(m)}" x2="${x(m)}" y1="${T}" y2="${H - B}"/><text class="tick" x="${x(m)}" y="${H - 8}" text-anchor="middle">${m}'</text>`;
  return s;
};

function figure(svg, data, caption) {
  return `<figure class="chart" data-chart="${attr(JSON.stringify(data))}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${attr(caption)}">${svg}
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/></svg>
    <figcaption class="chart-read">${caption}</figcaption></figure>`;
}

// Team A's gold lead per minute as a two-colour area (A above zero, B below), XP lead as a
// dashed line, and a marker on each side's biggest lead.
export function leadChart(adv, { xp = null, nameA = "Team A", nameB = "Team B", id = "lead" } = {}) {
  const n = adv.length;
  const max = niceMax(Math.max(...adv.map(Math.abs), ...(xp ?? []).map(Math.abs)));
  const x = xOf(n), y = (v) => T + (1 - (v + max) / (2 * max)) * (H - T - B), y0 = y(0);
  const area = `${path(adv, x, y)}L${x(n - 1)},${y0}L${x(0)},${y0}Z`;
  let grid = "";
  for (const v of [max, max / 2, -max / 2, -max]) grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v > 0 ? "+" : "−"}${k(Math.abs(v))}</text>`;
  const peak = (sign) => {
    let best = 0, at = -1;
    adv.forEach((v, i) => { if (v * sign > best) { best = v * sign; at = i; } });
    if (at < 0 || best < 1000) return "";
    const tx = Math.min(Math.max(x(at), L + 40), W - R - 40);
    return `<circle class="peak s-${sign > 0 ? "a" : "b"}" cx="${x(at)}" cy="${y(adv[at])}" r="4"/>
      <text class="peak-label s-${sign > 0 ? "a" : "b"}" x="${tx}" y="${y(adv[at]) + (sign > 0 ? -9 : 16)}" text-anchor="middle">${k(best)} @ ${at}'</text>`;
  };
  const svg = `<defs>
      <clipPath id="${id}-up"><rect x="0" y="0" width="${W}" height="${y0}"/></clipPath>
      <clipPath id="${id}-down"><rect x="0" y="${y0}" width="${W}" height="${H - y0}"/></clipPath></defs>
    ${grid}${xTicks(n, x)}
    <text class="side-label s-a" x="${L + 6}" y="${T + 11}">${attr(nameA)} ahead</text>
    <text class="side-label s-b" x="${L + 6}" y="${H - B - 6}">${attr(nameB)} ahead</text>
    <path class="area s-a" d="${area}" clip-path="url(#${id}-up)"/>
    <path class="area s-b" d="${area}" clip-path="url(#${id}-down)"/>
    <line class="zero" x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}"/>
    <path class="lead-line" d="${path(adv, x, y)}"/>
    ${xp ? `<path class="xp-line" d="${path(xp, x, y)}"/>` : ""}
    ${peak(1)}${peak(-1)}`;
  return figure(svg, { kind: "lead", n, x: [L, W - R], nameA, nameB, series: [{ label: "Gold", values: adv }, ...(xp ? [{ label: "XP", values: xp }] : [])] },
    `Hover for the lead at any minute. Solid: gold lead${xp ? "; dashed: XP lead" : ""}.`);
}

// Several lines on one 0-based axis (gold over time). series: { label, values, cls, dash?, strong? }
export function lineChart(series, { caption = "Hover for values at any minute.", id = "lines" } = {}) {
  const n = Math.max(...series.map((s) => s.values.length));
  const max = niceMax(Math.max(...series.flatMap((s) => s.values)));
  const x = xOf(n), y = (v) => T + (1 - v / max) * (H - T - B);
  let grid = "";
  for (const v of [max, max * 0.75, max / 2, max / 4]) grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${k(v)}</text>`;
  const lines = series.map((s, i) => `<path class="line ${s.cls ?? ""}${s.dash ? " dash" : ""}${s.strong ? " strong" : ""}" data-i="${i}" d="${path(s.values, x, y)}"><title>${attr(s.label)}</title></path>`).join("");
  const svg = `${grid}${xTicks(n, x)}<line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>${lines}`;
  const legend = `<div class="chart-legend">${series.map((s, i) => `<span class="lg-item ${s.cls ?? ""}${s.dash ? " dash" : ""}" data-i="${i}"><i></i>${attr(s.label)}</span>`).join("")}</div>`;
  return figure(svg, { kind: "lines", n, x: [L, W - R], series: series.map((s) => ({ label: s.label, values: s.values })) }, caption).replace("</figure>", `${legend}</figure>`);
}

// Hover crosshair + readout for every chart under root.
export function wireCharts(root) {
  root.querySelectorAll("figure.chart[data-chart]").forEach((fig) => {
    const d = JSON.parse(fig.dataset.chart);
    const svg = fig.querySelector("svg"), cross = fig.querySelector(".cross"), read = fig.querySelector(".chart-read");
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
      }
    });
    svg.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); read.innerHTML = idle; });
    // Legend hover highlights one line.
    fig.querySelectorAll(".lg-item").forEach((it) => {
      it.onmouseenter = () => {
        fig.classList.add("focus");
        fig.querySelector(`path[data-i="${it.dataset.i}"]`)?.classList.add("on");
      };
      it.onmouseleave = () => { fig.classList.remove("focus"); fig.querySelectorAll("path.on").forEach((p) => p.classList.remove("on")); };
    });
  });
}
