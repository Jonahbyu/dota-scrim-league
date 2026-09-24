// Engine-independent OCR helpers. An "engine" (Node: sharp, browser: canvas) supplies only:
//   engine.decode(input)                         -> { data, width, height, channels }  raw pixels
//   engine.recognize(bitmap, params, blocks?)    -> Tesseract result data
//   engine.debug?(name, bitmap)                  -> optional, saves crops for inspection
// A bitmap is { gray: Uint8Array, width, height }. Grayscale conversion, cropping, scaling
// and thresholding all happen here, so Node (tests) and the browser (site) see identical pixels.

export const PSM_LINE = "7";

// sRGB → luminance the way libvips/sharp does it (linearize, Rec.709 weights, re-encode).
// The thresholds in overview.js/scoreboard.js were tuned on these values.
const TO_LINEAR = Array.from({ length: 256 }, (_, v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toSrgb = (y) => Math.round(255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055));

export async function loadImage(engine, input) {
  const { data, width, height, channels } = await engine.decode(input);
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += channels) {
    gray[i] = toSrgb(0.2126 * TO_LINEAR[data[p]] + 0.7152 * TO_LINEAR[data[p + 1]] + 0.0722 * TO_LINEAR[data[p + 2]]);
  }
  return { gray, width, height };
}

export async function ocr(engine, bm, { whitelist = "", psm = PSM_LINE } = {}) {
  const data = await engine.recognize(bm, { tessedit_pageseg_mode: psm, tessedit_char_whitelist: whitelist });
  return { text: data.text.trim(), conf: data.confidence };
}

// Whole-image word boxes (used to find the Scoreboard headers): upscale 2×, invert,
// stretch contrast between the 1st and 99th percentile.
export async function findWords(engine, image, scale = 2) {
  const up = cropScaled(image, { x0: 0, y0: 0, x1: image.width, y1: image.height }, scale);
  const hist = new Array(256).fill(0);
  for (const v of up.gray) hist[v]++;
  const pct = (p) => { let n = 0; for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= p * up.gray.length) return v; } return 255; };
  const lo = pct(0.01), hi = Math.max(lo + 1, pct(0.99));
  for (let i = 0; i < up.gray.length; i++) {
    const v = Math.min(255, Math.max(0, ((up.gray[i] - lo) * 255) / (hi - lo)));
    up.gray[i] = 255 - Math.round(v);
  }
  const data = await engine.recognize(up, { tessedit_pageseg_mode: "3", tessedit_char_whitelist: "" }, true);
  const words = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) {
    words.push({ text: w.text, conf: w.confidence, x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale });
  }
  return words;
}

// Bicubic (Catmull-Rom) upscale of a grayscale region of `image`.
export function cropScaled(image, r, scale) {
  const W = (r.x1 - r.x0) * scale, H = (r.y1 - r.y0) * scale;
  const out = new Uint8Array(W * H);
  const { gray, width, height } = image;
  const px = (x, y) => gray[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  for (let y = 0; y < H; y++) {
    const sy = r.y0 + (y + 0.5) / scale - 0.5, iy = Math.floor(sy), fy = sy - iy;
    for (let x = 0; x < W; x++) {
      const sx = r.x0 + (x + 0.5) / scale - 0.5, ix = Math.floor(sx), fx = sx - ix;
      const c0 = cr(px(ix - 1, iy - 1), px(ix, iy - 1), px(ix + 1, iy - 1), px(ix + 2, iy - 1), fx);
      const c1 = cr(px(ix - 1, iy), px(ix, iy), px(ix + 1, iy), px(ix + 2, iy), fx);
      const c2 = cr(px(ix - 1, iy + 1), px(ix, iy + 1), px(ix + 1, iy + 1), px(ix + 2, iy + 1), fx);
      const c3 = cr(px(ix - 1, iy + 2), px(ix, iy + 2), px(ix + 1, iy + 2), px(ix + 2, iy + 2), fx);
      out[y * W + x] = Math.max(0, Math.min(255, Math.round(cr(c0, c1, c2, c3, fy))));
    }
  }
  return { gray: out, width: W, height: H };
}

// Light-on-dark UI text → dark-on-white bitmap Tesseract likes.
// With a threshold: pixels brighter than it become black ink, everything else white.
// Without: contrast-stretch and invert.
// Otsu's method: the cutoff that best separates the two brightness populations.
export function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; bestT = t; }
  }
  return bestT;
}

// threshold: a number; "otsu" (per-crop automatic, floored at `min`); { rel } (that
// fraction of the crop's brightest text, 98th percentile — survives colour shifts, for
// plain backgrounds only); or null (stretch).
export function binarize(bm, threshold, min = 60) {
  if (threshold === "otsu") threshold = Math.max(min, otsu(bm.gray));
  else if (threshold?.rel) {
    const sorted = Uint8Array.from(bm.gray).sort();
    threshold = Math.max(min, Math.round(sorted[Math.floor(sorted.length * 0.98)] * threshold.rel));
  }
  const out = new Uint8Array(bm.gray.length);
  if (threshold != null) {
    for (let i = 0; i < out.length; i++) out[i] = bm.gray[i] > threshold ? 0 : 255;
  } else {
    let lo = 255, hi = 0;
    for (const v of bm.gray) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < out.length; i++) out[i] = 255 - Math.round(((bm.gray[i] - lo) * 255) / span);
  }
  return { gray: out, width: bm.width, height: bm.height };
}

// Remove connected blobs of ink smaller than minFrac × height² (sparkles, tag remnants,
// antialias dust). Sized so a "." in a name at 3× scale survives.
export function despeckle(bm, minFrac = 0.005) {
  const { width: W, height: H } = bm;
  const gray = Uint8Array.from(bm.gray);
  const seen = new Uint8Array(W * H);
  const minArea = minFrac * H * H;
  const stack = [];
  for (let start = 0; start < gray.length; start++) {
    if (seen[start] || gray[start] >= 128) continue;
    const blob = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      blob.push(i);
      const x = i % W, y = (i - x) / W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && !seen[j] && gray[j] < 128) { seen[j] = 1; stack.push(j); }
      }
    }
    if (blob.length < minArea) for (const i of blob) gray[i] = 255;
  }
  return { gray, width: W, height: H };
}

export function pad(bm, n = 20) {
  const width = bm.width + 2 * n, height = bm.height + 2 * n;
  const gray = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < bm.height; y++) gray.set(bm.gray.subarray(y * bm.width, (y + 1) * bm.width), (y + n) * width + n);
  return { gray, width, height };
}

function slice(bm, x0, x1) {
  const width = x1 - x0;
  const gray = new Uint8Array(width * bm.height);
  for (let y = 0; y < bm.height; y++) gray.set(bm.gray.subarray(y * bm.width + x0, y * bm.width + x1), y * width);
  return { gray, width, height: bm.height };
}

export function columnProfile(image, y0, y1) {
  const { gray, width } = image;
  const out = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = y0; y < y1; y++) s += gray[y * width + x];
    out[x] = s / (y1 - y0);
  }
  return out;
}

export function rowProfile(image, x0, x1) {
  const { gray, width, height } = image;
  const out = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0;
    for (let x = x0; x < x1; x++) s += gray[y * width + x];
    out[y] = s / (x1 - x0);
  }
  return out;
}

// Contiguous runs where profile > threshold, at least minLen long.
export function runs(profile, threshold, minLen) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i++) {
    const on = i < profile.length && profile[i] > threshold;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= minLen) out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

const isInk = (bm, x, y) => bm.gray[y * bm.width + x] < 128;

// Glyphs = runs of columns containing ink. For each: column span, ink amount, and how
// strongly the ink's vertical centre moves with x. A "/" leans, so its centre rises
// steadily left→right (correlation ≈ −1); digits measured between −0.45 and +0.85.
function glyphs(bm) {
  const ink = new Float64Array(bm.width);
  for (let x = 0; x < bm.width; x++) for (let y = 0; y < bm.height; y++) if (isInk(bm, x, y)) ink[x]++;
  return runs(ink, 0, 1).map(([a, b]) => {
    const xs = [], ys = [];
    let amount = 0;
    for (let x = a; x < b; x++) {
      let s = 0, n = 0;
      for (let y = 0; y < bm.height; y++) if (isInk(bm, x, y)) { s += y; n++; }
      if (n) { xs.push(x); ys.push(s / n); amount += n; }
    }
    const mx = xs.reduce((p, c) => p + c, 0) / xs.length, my = ys.reduce((p, c) => p + c, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    xs.forEach((x, j) => { sxy += (x - mx) * (ys[j] - my); sxx += (x - mx) ** 2; syy += (ys[j] - my) ** 2; });
    return { a, b, amount, lean: sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0 };
  });
}

// Split "a / b / c" into the number parts. Separators are found by shape (slashes),
// or — when a dim slash didn't survive thresholding — by the widest gaps.
export function numberGroups(bm, count) {
  const gs = glyphs(bm).filter((g) => g.amount > bm.height * 0.6); // drop specks
  const merge = (list) => [list[0].a, list[list.length - 1].b];

  const parts = [[]];
  for (const g of gs) {
    if (g.lean < -0.9) parts.push([]); else parts[parts.length - 1].push(g);
  }
  const numbers = parts.filter((p) => p.length);
  if (numbers.length === count) return numbers.map(merge);

  // No usable slashes: cut at the (count − 1) widest gaps.
  if (gs.length < count) return [];
  const gaps = gs.slice(1).map((g, i) => ({ i: i + 1, w: g.a - gs[i].b })).sort((x, y) => y.w - x.w);
  const cuts = gaps.slice(0, count - 1).map((g) => g.i).sort((x, y) => x - y);
  const out = [];
  let start = 0;
  for (const c of [...cuts, gs.length]) { out.push(merge(gs.slice(start, c))); start = c; }
  return out;
}

const clampRect = (image, r) => {
  const x0 = Math.max(0, Math.round(r.x0)), y0 = Math.max(0, Math.round(r.y0));
  const x1 = Math.min(image.width, Math.round(r.x1)), y1 = Math.min(image.height, Math.round(r.y1));
  return x1 - x0 >= 4 && y1 - y0 >= 4 ? { x0, y0, x1, y1 } : null;
};

// Read one region as a single line of text.
// `speckle`: remove blobs smaller than this fraction of height² (thresholded crops only).
export async function readRegion(engine, image, rect, { whitelist = "", scale = 3, threshold = null, min, speckle = 0, name } = {}) {
  const r = clampRect(image, rect);
  if (!r) return { text: "", conf: 0 };
  const bin = binarize(cropScaled(image, r, scale), threshold, min);
  const bm = pad(speckle && threshold != null ? despeckle(bin, speckle) : bin);
  engine.debug?.(name, bm);
  return ocr(engine, bm, { whitelist });
}

// Read a player name, dropping the clan tag after it. Tags are drawn dimmer than names,
// so split the cell into words and keep words while they're at least `ratio` as bright
// as the first one. Everything is relative, so a browser's colour conversion (which
// shifts all the grays) doesn't matter. Measured: names ~200–255, tags ~115–195.
export async function readName(engine, image, rect, { scale = 3, ratio = 0.85, gapFrac = 0.15, name } = {}) {
  const r = clampRect(image, rect);
  if (!r) return { text: "", conf: 0 };
  const bm = cropScaled(image, r, scale);
  const inkT = Math.min(140, Math.max(70, otsu(bm.gray)));
  const ink = new Float64Array(bm.width);
  for (let x = 0; x < bm.width; x++) for (let y = 0; y < bm.height; y++) if (bm.gray[y * bm.width + x] > inkT) ink[x]++;
  const words = [];
  for (const g of runs(ink, 0, 1)) {
    const w = words[words.length - 1];
    if (w && g[0] - w[1] < bm.height * gapFrac) w[1] = g[1]; else words.push([...g]);
  }
  const bright = ([x0, x1]) => {
    const vals = [];
    for (let x = x0; x < x1; x++) for (let y = 0; y < bm.height; y++) { const v = bm.gray[y * bm.width + x]; if (v > inkT) vals.push(v); }
    vals.sort((p, q) => p - q);
    return vals.length ? vals[Math.floor(vals.length * 0.9)] : 0;
  };
  if (!words.length) return { text: "", conf: 0 };
  const ref = bright(words[0]);
  let end = words[0][1];
  for (const w of words.slice(1)) {
    if (bright(w) < ref * ratio) break;
    end = w[1];
  }
  const cut = slice(bm, 0, Math.min(bm.width, end + Math.round(bm.height * 0.1)));
  // Cut at ~83% of the name's brightness: thin enough strokes for clean letters (the old
  // fixed 170 on ~205-bright names), and relative so colour shifts don't matter.
  const bin = pad(binarize(cut, Math.max(inkT, Math.round(ref * 0.83))));
  engine.debug?.(name, bin);
  return ocr(engine, bin);
}

// Read a region made of separate numbers ("4 / 5 / 19", "338 / 10"): find the parts,
// OCR each number on its own. Returns [] if it can't find `count` parts.
export async function readNumberGroups(engine, image, rect, { count, scale = 3, threshold = 140, min, name } = {}) {
  const r = clampRect(image, rect);
  if (!r) return [];
  const bm = despeckle(binarize(cropScaled(image, r, scale), threshold, min));
  engine.debug?.(name, pad(bm));
  const groups = numberGroups(bm, count);
  if (groups.length !== count) return [];
  const out = [];
  for (const [a, b] of groups) {
    const piece = pad(slice(bm, Math.max(0, a - 2), Math.min(bm.width, b + 2)), 30);
    const { text } = await ocr(engine, piece, { whitelist: "0123456789" });
    const n = text.replace(/\D/g, "");
    out.push(n ? Number(n) : null);
  }
  return out;
}
