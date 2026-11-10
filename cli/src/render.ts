import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import { type Img, pixels } from "./image";
import type { Scene } from "./raster";
import type { Box, Mark, Note, Pt, Side, Style } from "./types";

export const FONT_PATH = fileURLToPath(new URL("../fonts/Poah-Regular.ttf", import.meta.url));
export const DEFAULT_COLOR = "#1d3fd6";
/** Same ink, lifted so it stays readable on dark UI. */
export const DARK_COLOR = "#7b9bff";
/** For a note whose label and target sit on opposite (light vs dark) ground. */
export const MID_COLOR = "#4d6df5";
/** The neutral surface a screenshot sits on once notes spill outside it. */
export const SURFACE = "#f4f4f5";
const SURFACE_LUM = 244;
const buf = readFileSync(FONT_PATH);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (n: number) => Math.round(n * 10) / 10;
const expand = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });

export function fontSize(w: number, h: number, style: Partial<Style>) {
  if (style.size) return style.size;
  if (style.dpr) return Math.round(22 * style.dpr);
  return clamp(Math.round(Math.max(w, h * 0.75) / 42), 18, 96);
}

function overlap(a: Box, b: Box) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.max(1, a.w * a.h) : 0;
}

/** Whether a cubic arrow [s, c1, c2, e] passes through a box (the tip's last stretch excluded). */
function curveHits(p: Pt[], b: Box) {
  for (let t = 0.05; t <= 0.9; t += 0.05) {
    const u = 1 - t;
    const x = u ** 3 * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t ** 3 * p[3][0];
    const y = u ** 3 * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t ** 3 * p[3][1];
    if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
  }
  return false;
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** How cluttered each region of the screenshot is, so labels land in empty space. */
export function analyze(img: Img) {
  const W = img.width;
  const H = img.height;
  const px = pixels(img);
  const counts = new Map<number, [number, number, number, number]>();
  const sample = (i: number) => {
    const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
    const c = counts.get(key);
    if (c) c[3]++;
    else counts.set(key, [px[i], px[i + 1], px[i + 2], 1]);
  };
  for (let x = 0; x < W; x += 2) {
    sample(x * 4);
    sample(((H - 1) * W + x) * 4);
  }
  for (let y = 0; y < H; y += 2) {
    sample(y * W * 4);
    sample((y * W + W - 1) * 4);
  }
  const [br, bg, bb] = [...counts.values()].sort((a, b) => b[3] - a[3])[0];

  // Count edges (text, borders, icons) and non-background fill per c x c cell, then build integral
  // images over the cells. Cells keep memory flat on huge screenshots; queries are box densities,
  // so a cell of a few pixels changes nothing visible.
  const c = Math.max(1, Math.ceil(Math.sqrt((W * H) / 2_000_000)));
  const CW = Math.ceil(W / c);
  const CH = Math.ceil(H / c);
  const S = CW + 1;
  const esum = new Uint32Array(S * (CH + 1));
  const fsum = new Uint32Array(S * (CH + 1));
  const ecell = new Uint32Array(CW);
  const fcell = new Uint32Array(CW);
  let next = new Uint8Array(W);
  let cur = new Uint8Array(W);
  // Integer luma, 0.299/0.587/0.114 scaled by 256.
  const luma = (row: Uint8Array, y: number) => {
    for (let x = 0, i = y * W * 4; x < W; x++, i += 4) row[x] = (77 * px[i] + 150 * px[i + 1] + 29 * px[i + 2]) >> 8;
  };
  luma(cur, 0);
  for (let y = 0; y < H; y++) {
    if (y + 1 < H) luma(next, y + 1);
    else next.set(cur);
    for (let x = 0, i = y * W * 4; x < W; x++, i += 4) {
      const l = cur[x];
      const grad = Math.abs(l - cur[x + 1 < W ? x + 1 : x]) + Math.abs(l - next[x]);
      const diff = Math.abs(px[i] - br) + Math.abs(px[i + 1] - bg) + Math.abs(px[i + 2] - bb);
      const cx = (x / c) | 0;
      if (grad > 9) ecell[cx]++;
      if (diff > 12) fcell[cx]++;
    }
    if ((y + 1) % c === 0 || y === H - 1) {
      const cy = (y / c) | 0;
      let erow = 0;
      let frow = 0;
      for (let cx = 0; cx < CW; cx++) {
        erow += ecell[cx];
        frow += fcell[cx];
        const k = (cy + 1) * S + cx + 1;
        esum[k] = esum[k - S] + erow;
        fsum[k] = fsum[k - S] + frow;
      }
      ecell.fill(0);
      fcell.fill(0);
    }
    [cur, next] = [next, cur];
  }

  const area = (t: Uint32Array, b: Box) => {
    const x0 = clamp(Math.round(b.x / c), 0, CW);
    const y0 = clamp(Math.round(b.y / c), 0, CH);
    const x1 = clamp(Math.round((b.x + b.w) / c), 0, CW);
    const y1 = clamp(Math.round((b.y + b.h) / c), 0, CH);
    if (x1 <= x0 || y1 <= y0) return 0;
    const sum = t[y1 * S + x1] - t[y0 * S + x1] - t[y1 * S + x0] + t[y0 * S + x0];
    // Normalise by the requested box, so parts outside the image count as empty.
    return sum / Math.max(1, b.w * b.h, c * c);
  };
  return {
    bg: `rgb(${br},${bg},${bb})`,
    dark: 0.299 * br + 0.587 * bg + 0.114 * bb < 110,
    edges: (b: Box) => area(esum, b),
    fill: (b: Box) => area(fsum, b),
    /** Mean luminance of the part of `b` inside the image; the margin surface counts as light. */
    lum(b: Box) {
      if (overlap(b, { x: 0, y: 0, w: W, h: H }) < 0.5) return SURFACE_LUM;
      const x0 = clamp(Math.floor(b.x), 0, W - 1);
      const y0 = clamp(Math.floor(b.y), 0, H - 1);
      const x1 = clamp(Math.ceil(b.x + b.w), x0 + 1, W);
      const y1 = clamp(Math.ceil(b.y + b.h), y0 + 1, H);
      const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 900)));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += step)
        for (let x = x0, i = (y * W + x0) * 4; x < x1; x += step, i += 4 * step) {
          sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          n++;
        }
      return sum / Math.max(1, n);
    },
    /** Edge density of the busiest fs-sized cell, so one corner of text under a label still counts. */
    edgePeak(b: Box, fs: number) {
      let max = 0;
      for (let y = b.y; y < b.y + b.h; y += fs * 0.5)
        for (let x = b.x; x < b.x + b.w; x += fs * 0.5) max = Math.max(max, area(esum, { x, y, w: fs, h: fs }));
      return max;
    },
    outside: (b: Box) => 1 - overlap(b, { x: 0, y: 0, w: W, h: H }),
  };
}

/**
 * How many spots along a path (a straight [s, e] or a cubic [s, c1, c2, e]) sit on edges,
 * skipping the last stretch before the tip, which naturally touches the target.
 */
function crossings(A: ReturnType<typeof analyze>, p: Pt[], fs: number) {
  const at = (t: number): Pt => {
    if (p.length === 2) return [p[0][0] + (p[1][0] - p[0][0]) * t, p[0][1] + (p[1][1] - p[0][1]) * t];
    const u = 1 - t;
    const f = (i: 0 | 1) => u ** 3 * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t ** 3 * p[3][i];
    return [f(0), f(1)];
  };
  const end = p[p.length - 1];
  let hits = 0;
  let last: Pt | null = null;
  for (let t = 0; t <= 1; t += 0.01) {
    const q = at(t);
    if (Math.hypot(q[0] - end[0], q[1] - end[1]) < fs * 1.1) break;
    if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < fs * 0.4) continue;
    last = q;
    if (A.edges({ x: q[0] - fs * 0.3, y: q[1] - fs * 0.3, w: fs * 0.6, h: fs * 0.6 }) > 0.1) hits++;
  }
  return hits;
}

function prepare(text: string, fs: number, wrap: number, warnings: string[]) {
  const clean = text.replace(/ß/g, "ss").replace(/ẞ/g, "SS");
  const missing = [...new Set([...clean].filter((c) => c.trim() && font.charToGlyphIndex(c) === 0))];
  if (missing.length) warnings.push(`Poah has no glyph for ${missing.join(" ")} in "${text}"`);
  const width = (s: string) => font.getAdvanceWidth(s, fs);
  const greedy = (para: string, max: number) => {
    const out: string[] = [];
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > max) {
        out.push(line);
        line = word;
      } else line = next;
    }
    return [...out, line];
  };
  const lines = clean.split("\n").flatMap((para) => {
    const first = greedy(para, fs * wrap);
    if (first.length < 2) return first;
    // Shrink the width as far as the line count allows, so lines come out even.
    let lo = width(para) / first.length;
    let hi = fs * wrap;
    while (hi - lo > 2) {
      const mid = (lo + hi) / 2;
      if (greedy(para, mid).length > first.length) lo = mid;
      else hi = mid;
    }
    return greedy(para, hi);
  });
  return { lines, w: Math.max(...lines.map(width)), lh: fs * 1.22 };
}

type Label = ReturnType<typeof prepare>;

function candidates(T: Box, L: Label, fs: number, only?: Side) {
  const h = L.lh * L.lines.length;
  const cx = T.x + T.w / 2;
  const cy = T.y + T.h / 2;
  const out: { box: Box; side: Side; d: number }[] = [];
  const add = (side: Side, x: number, y: number, d: number) => {
    if (!only || only === side) out.push({ box: { x, y, w: L.w, h }, side, d });
  };
  for (const k of [2.2, 3.2, 4.4, 6, 8.5, 12, 17]) {
    const d = k * fs;
    for (let line = 0; line < L.lines.length; line++)
      for (const shift of [0, -1.2, 1.2, -2.5, 2.5]) {
        const y = cy - (line * L.lh + fs * 0.63) + shift * L.lh;
        add("right", T.x + T.w + d, y, d);
        add("left", T.x - d - L.w, y, d);
      }
    if (k > 8.5) continue;
    for (const a of [-0.15, 0.2, 0.5, 0.8, 1.15]) {
      add("above", cx - L.w * a, T.y - d * 0.7 - h, d);
      add("below", cx - L.w * a, T.y + T.h + d * 0.7, d);
    }
  }
  return out;
}

/** Where the arrow leaves the label, which way it heads first, and where it lands. */
function anchor(lb: Box, L: Label, T: Box, point: boolean, fs: number) {
  const g = fs * 0.35;
  const g2 = point ? 0 : fs * 0.25;
  const cx = T.x + T.w / 2;
  const cy = T.y + T.h / 2;
  const gaps = {
    right: T.x - (lb.x + lb.w),
    left: lb.x - (T.x + T.w),
    below: T.y - (lb.y + lb.h),
    above: lb.y - (T.y + T.h),
  };
  const side = (Object.keys(gaps) as Side[]).reduce((a, b) => (gaps[b] > gaps[a] ? b : a));
  const mids = L.lines.map((_, i) => lb.y + i * L.lh + fs * 0.63);
  const mid = mids.reduce((a, b) => (Math.abs(b - cy) < Math.abs(a - cy) ? b : a));
  const sx = clamp(cx, lb.x + Math.min(fs, lb.w / 2), lb.x + lb.w - Math.min(fs, lb.w / 2));
  const [s, dir]: [Pt, Pt] =
    side === "right"
      ? [[lb.x + lb.w + g, mid], [1, 0]]
      : side === "left"
        ? [[lb.x - g, mid], [-1, 0]]
        : side === "below"
          ? [[sx, lb.y + lb.h + g * 0.3], [0, 1]]
          : [[sx, lb.y - g * 0.5], [0, -1]];
  if (point) return { s, dir, e: [cx, cy] as Pt };
  // Aim between the nearest spot and the centre, then stop where the line enters the box,
  // so wide targets get hit on the facing edge rather than at a far corner.
  const near: Pt = [clamp(s[0], T.x, T.x + T.w), clamp(s[1], T.y, T.y + T.h)];
  const aim: Pt = [near[0] + (cx - near[0]) * 0.6, near[1] + (cy - near[1]) * 0.6];
  const B = expand(T, g2);
  const dx = aim[0] - s[0];
  const dy = aim[1] - s[1];
  let t0 = 0;
  for (const [d, p, lo, hi] of [
    [dx, s[0], B.x, B.x + B.w],
    [dy, s[1], B.y, B.y + B.h],
  ]) {
    if (Math.abs(d) < 1e-9) continue;
    t0 = Math.max(t0, Math.min((lo - p) / d, (hi - p) / d));
  }
  t0 = clamp(t0, 0, 1);
  return { s, dir, e: [s[0] + dx * t0, s[1] + dy * t0] as Pt };
}

function arrow(s: Pt, dir: Pt, e: Pt, bend: number | undefined, fs: number) {
  const dx = e[0] - s[0];
  const dy = e[1] - s[1];
  const len = Math.max(1, Math.hypot(dx, dy));
  let px = -dy / len;
  let py = dx / len;
  if (py > 0 || (py === 0 && px < 0)) [px, py] = [-px, -py];
  // Curvature grows with length only up to a point, so long arrows don't swing into nearby rows.
  const b = (bend ?? 0.12) * Math.min(len, fs * 7);
  const c1: Pt = [s[0] + dir[0] * len * 0.35 + px * b * 0.5, s[1] + dir[1] * len * 0.35 + py * b * 0.5];
  const c2: Pt = [e[0] - dx * 0.3 + px * b, e[1] - dy * 0.3 + py * b];
  const tl = Math.max(1e-6, Math.hypot(e[0] - c2[0], e[1] - c2[1]));
  const ux = (e[0] - c2[0]) / tl;
  const uy = (e[1] - c2[1]) / tl;
  const hl = fs * 0.5;
  const hw = fs * 0.24;
  const head: Pt[] = [
    e,
    [e[0] - ux * hl - uy * hw, e[1] - uy * hl + ux * hw],
    [e[0] - ux * hl * 0.7, e[1] - uy * hl * 0.7],
    [e[0] - ux * hl + uy * hw, e[1] - uy * hl - ux * hw],
  ];
  // Stop the line inside the head so the tip stays sharp.
  const end: Pt = [e[0] - ux * hl * 0.6, e[1] - uy * hl * 0.6];
  return {
    line: `M${r1(s[0])},${r1(s[1])} C${r1(c1[0])},${r1(c1[1])} ${r1(c2[0])},${r1(c2[1])} ${r1(end[0])},${r1(end[1])}`,
    head: `M${head.map((p) => `${r1(p[0])},${r1(p[1])}`).join(" L")} Z`,
    pts: [s, c1, c2, e, ...head],
  };
}

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function mark(kind: Mark, T: Box, fs: number, seed: string) {
  const rand = rng(seed);
  const p = fs * 0.3;
  if (kind === "underline") {
    const y = T.y + T.h + p * 0.6;
    const x0 = T.x - p * 0.5;
    const x1 = T.x + T.w + p * 0.5;
    const wob = fs * 0.12 * (rand() > 0.5 ? 1 : -1);
    return {
      d: `M${r1(x0)},${r1(y + wob * 0.4)} Q${r1((x0 + x1) / 2)},${r1(y + wob)} ${r1(x1)},${r1(y - wob * 0.6)}`,
      box: { x: x0, y: y - fs * 0.2, w: x1 - x0, h: fs * 0.4 },
    };
  }
  if (kind === "box") {
    const b = expand(T, p);
    const j = () => (rand() - 0.5) * fs * 0.12;
    const c: Pt[] = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h],
      [b.x, b.y + b.h],
    ];
    const d = c.map((q, i) => `${i ? "L" : "M"}${r1(q[0] + j())},${r1(q[1] + j())}`).join(" ");
    return { d: `${d} L${r1(c[0][0] + fs * 0.15 + j())},${r1(c[0][1] + j())}`, box: expand(b, fs * 0.1) };
  }
  const cx = T.x + T.w / 2;
  const cy = T.y + T.h / 2;
  const rx = T.w / 2 + p + T.w * 0.08;
  const ry = T.h / 2 + p + T.h * 0.12;
  const a0 = -Math.PI * (0.55 + rand() * 0.2);
  const phase = rand() * Math.PI * 2;
  const pts: string[] = [];
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + t * Math.PI * 2 * 1.07;
    const k = 1 + 0.025 * Math.sin(2 * a + phase) + t * 0.05;
    pts.push(`${i ? "L" : "M"}${r1(cx + Math.cos(a) * rx * k)},${r1(cy + Math.sin(a) * ry * k)}`);
  }
  return { d: pts.join(" "), box: { x: cx - rx * 1.06, y: cy - ry * 1.06, w: rx * 2.12, h: ry * 2.12 } };
}

export type Annotated = {
  scene: Scene;
  fs: number;
  warnings: string[];
  resolved: Note[];
  extended: boolean;
  /** Where the original image's top-left sits on the (possibly grown) canvas. */
  offset: Pt;
};

export type Layout = {
  /** Font size override (compare uses one size for both panels). */
  fs?: number;
  /** Always show the screenshot as a rounded card on the neutral surface. */
  card?: boolean;
  /** Minimum surface margin around the screenshot when shown as a card, in font sizes. */
  pad?: number;
};

const cubicAt = (p: Pt[], t: number): Pt => {
  const u = 1 - t;
  const f = (i: 0 | 1) => u ** 3 * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t ** 3 * p[3][i];
  return [f(0), f(1)];
};

const inBox = ([x, y]: Pt, b: Box) => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h;

export function annotate(img: Img, notes: Note[], style: Partial<Style>, layout: Layout = {}): Annotated {
  const W = img.width;
  const H = img.height;
  const warnings: string[] = [];
  const wanted = layout.fs ?? fontSize(W, H, { ...style, dpr: style.dpr ?? img.dpr });
  // A note taller than a quarter of the screenshot is never what anyone meant.
  const maxFs = Math.max(16, Math.round(Math.max(W, H) / 4));
  const fs = Math.min(wanted, maxFs);
  if (fs < wanted) warnings.push(`font size ${wanted} is too big for a ${W}x${H} image, using ${fs}`);
  const sw = r1(Math.max(1.5, fs / 11));
  const A = analyze(img);
  const els: string[] = [];
  const bounds: Box[] = [];
  const placed: Box[] = [];
  const arrows: [Pt, Pt][] = [];
  const arrowPts: Pt[] = [];
  /** Per note, for the final check: its label box and the sampled points of its arrow. */
  const labels: (Box | null)[] = [];
  const paths: Pt[][] = [];
  const resolved: Note[] = [];

  const image: Box = { x: 0, y: 0, w: W, h: H };
  // Labels may sit in a margin around the screenshot, but not arbitrarily far from it.
  const reach = expand(image, Math.max(W, H));
  const targets = notes.map((n, i) => {
    if (!n.to) return null;
    if (n.to.length !== 2 && n.to.length !== 4) throw new Error(`note ${i + 1}: "to" must be [x, y] or [x, y, w, h]`);
    const [x0, y0, w0 = 0, h0 = 0] = n.to;
    // Accept boxes drawn from any corner.
    const box = { x: Math.min(x0, x0 + w0), y: Math.min(y0, y0 + h0), w: Math.abs(w0), h: Math.abs(h0) };
    const hit = n.to.length === 2 ? inBox([x0, y0], expand(image, 1)) : overlap(expand(box, 1), image) > 0;
    if (!hit) throw new Error(`note ${i + 1} ("${n.text.slice(0, 30)}"): "to" [${n.to.join(", ")}] lies outside the ${W}x${H} image`);
    return { box, point: n.to.length === 2 };
  });
  const none: Box = { x: -1e9, y: -1e9, w: 0, h: 0 };
  const obstacles = targets.map((t) => (t ? expand(t.box, t.point ? fs * 0.6 : fs * 0.25) : none));

  notes.forEach((n, i) => {
    let L = prepare(n.text, fs, n.wrap ?? 11, warnings);
    if (L.lines.length > 4) {
      if (n.wrap === undefined) {
        // Aim for a block roughly four times wider than tall instead of a tall column.
        const area = L.lines.length * L.w * L.lh;
        L = prepare(n.text, fs, Math.sqrt(area * 4) / fs, []);
      }
      if (L.lines.length > 4)
        warnings.push(`"${L.lines[0].slice(0, 30)}" runs to ${L.lines.length} lines; notes read best at 2 to 8 words`);
    }
    const lh = L.lh * L.lines.length;
    const t = targets[i];
    let T = t?.box;
    const mk = t && n.mark ? mark(n.mark, t.box, fs, n.text) : null;
    if (mk && n.mark !== "underline") T = mk.box;

    let lb: Box;
    if (Array.isArray(n.at)) {
      lb = { x: n.at[0], y: n.at[1], w: L.w, h: lh };
      const inside = lb.x >= reach.x && lb.y >= reach.y && lb.x + lb.w <= reach.x + reach.w && lb.y + lb.h <= reach.y + reach.h;
      if (!inside)
        throw new Error(`note ${i + 1} ("${n.text.slice(0, 30)}"): "at" [${n.at.join(", ")}] is too far from the ${W}x${H} image`);
    }
    else if (T) {
      const ranked = candidates(T, L, fs, n.at).map((c) => {
        const pad = expand(c.box, fs * 0.3);
        let s = A.edges(expand(c.box, fs * 0.5)) * 400 + A.edgePeak(expand(c.box, fs * 0.6), fs) * 150 + A.fill(pad) * 30;
        const out = A.outside(pad);
        // Fully on the screenshot or fully in the margin; straddling its edge looks broken.
        s += out * 12 + (out > 0.01 ? 6 : 0) + (out > 0.02 && out < 0.98 ? 40 : 0);
        for (const o of placed) s += overlap(pad, o) * 400;
        // Hiding any part of another note's target is as bad as hiding most of it.
        obstacles.forEach((o, k) => {
          if (k !== i) s += Math.max(overlap(pad, o), overlap(o, pad)) * 400;
        });
        s += Math.abs(c.d / fs - 3.2) * (c.d / fs > 3.2 ? 0.8 : 1.5) + (c.side === "above" || c.side === "below" ? 2.5 : 0);
        const a = anchor(c.box, L, T, !!t?.point, fs);
        const curve = arrow(a.s, a.dir, a.e, n.bend, fs).pts.slice(0, 4);
        s += crossings(A, curve, fs) * 18;
        // Long arrows sweeping across the UI read worse than a nearby label, even when they miss text.
        s += Math.max(0, Math.hypot(a.e[0] - a.s[0], a.e[1] - a.s[1]) / fs - 5) * 1.5;
        for (const [p, q] of arrows) if (segmentsCross(a.s, a.e, p, q)) s += 15;
        for (const o of placed) if (curveHits(curve, o)) s += 60;
        if (arrowPts.some((p) => inBox(p, pad))) s += 80;
        return { ...c, s };
      });
      ranked.sort((a, b) => a.s - b.s);
      if (process.env.ANNOTATE_DEBUG)
        console.error(
          n.text,
          (["left", "right", "above", "below"] as Side[]).map((side) => {
            const c = ranked.find((r) => r.side === side);
            return c ? `${side} d=${Math.round(c.d / fs)} s=${c.s.toFixed(1)} @${Math.round(c.box.x)},${Math.round(c.box.y)}` : side;
          }),
        );
      lb = ranked[0].box;
    } else throw new Error(`note needs "to" or "at": ${n.text}`);

    // Flat fills (a card, a second background colour) are fine to write on; edges mean text or UI.
    const crowded = A.edgePeak(expand(lb, fs * 0.15), fs) > 0.06;
    if (crowded || placed.some((p) => overlap(lb, p) > 0) || arrowPts.some((p) => inBox(p, lb)))
      warnings.push(
        `"${L.lines[0]}" (label box [${[lb.x, lb.y, lb.w, lb.h].map(Math.round).join(", ")}]) ${crowded ? "covers or touches content" : "collides with another note or arrow"}; move it with "at"`,
      );
    placed.push(expand(lb, fs * 0.6));
    labels[i] = lb;
    bounds.push(lb);

    // Ink follows what it is drawn on: deep blue on light, lifted blue on dark, in between when mixed.
    const darkLabel = A.lum(lb) < 110;
    const darkTarget = T ? A.lum(expand(T, fs * 0.4)) < 110 : darkLabel;
    const color =
      n.color ?? style.color ?? (darkLabel && darkTarget ? DARK_COLOR : !darkLabel && !darkTarget ? DEFAULT_COLOR : MID_COLOR);

    if (mk) {
      els.push(
        `<path d="${mk.d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
      bounds.push(mk.box);
    }
    const inMargin = A.outside(lb) > 0.5;
    const halo =
      !inMargin && A.edges(lb) > 0.01
        ? ` stroke="${A.bg}" stroke-width="${r1(fs * 0.22)}" stroke-linejoin="round" paint-order="stroke"`
        : "";
    L.lines.forEach((line, k) =>
      els.push(
        `<text x="${r1(lb.x)}" y="${r1(lb.y + k * L.lh + fs * 0.9)}" font-family="Poah" font-size="${fs}" fill="${color}"${halo} xml:space="preserve">${esc(line)}</text>`,
      ),
    );

    if (T && n.arrow !== false) {
      const a = anchor(lb, L, T, !!t?.point && !n.mark, fs);
      const ar = arrow(a.s, a.dir, a.e, n.bend, fs);
      els.push(
        `<path d="${ar.line}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`,
        `<path d="${ar.head}" fill="${color}" stroke="${color}" stroke-width="${r1(sw * 0.6)}" stroke-linejoin="round"/>`,
      );
      arrows.push([a.s, a.e]);
      const samples: Pt[] = [];
      for (let k = 0; k <= 0.9; k += 0.05) samples.push(cubicAt(ar.pts, k));
      arrowPts.push(...samples);
      paths[i] = samples;
      // One or two hits is the arrow entering a card to reach its target; more is crossing text.
      if (process.env.ANNOTATE_DEBUG)
        console.error(`arrow "${L.lines[0]}" crossings=${crossings(A, ar.pts.slice(0, 4), fs)}`, ar.pts.slice(0, 4).map((p) => p.map(Math.round)));
      if (crossings(A, ar.pts.slice(0, 4), fs) >= 3)
        warnings.push(`the arrow from "${L.lines[0]}" crosses content; try another "at" or a different "bend"`);
      const xs = ar.pts.map((p) => p[0]);
      const ys = ar.pts.map((p) => p[1]);
      bounds.push({
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      });
    }
    resolved.push({
      ...n,
      at: [Math.round(lb.x), Math.round(lb.y)],
      label: [lb.x, lb.y, lb.w, lb.h].map(Math.round),
    });
  });

  paths.forEach((pts, i) => {
    const hit = labels.findIndex((lb, k) => k !== i && lb && pts.some((p) => inBox(p, lb)));
    if (hit >= 0) warnings.push(`the arrow of note ${i + 1} runs through the label of note ${hit + 1}; move one of them with "at"`);
  });

  // Anything drawn outside the screenshot turns it into a card on the neutral surface.
  const m = fs * 0.6;
  let minX = Math.min(0, ...bounds.map((b) => b.x - m));
  let minY = Math.min(0, ...bounds.map((b) => b.y - m));
  let maxX = Math.max(W, ...bounds.map((b) => b.x + b.w + m));
  let maxY = Math.max(H, ...bounds.map((b) => b.y + b.h + m));
  const extended = minX < 0 || minY < 0 || maxX > W || maxY > H;
  if (extended || layout.card) {
    const p = fs * (layout.pad ?? 0.6);
    minX = Math.min(minX, -p);
    minY = Math.min(minY, -p);
    maxX = Math.max(maxX, W + p);
    maxY = Math.max(maxY, H + p);
  }
  const card = extended || !!layout.card;
  // Whole-pixel offset, so the screenshot is copied 1:1 and never resampled.
  const ox = Math.ceil(-minX);
  const oy = Math.ceil(-minY);
  const width = Math.ceil(maxX) + ox;
  const height = Math.ceil(maxY) + oy;
  if (width > 16384 || height > 16384 || width * height > 80e6)
    throw new Error(`the notes would need a ${width}x${height} canvas; shorten them or lower "size"`);
  const radius = card ? r1(fs * 0.35) : 0;
  const overlay = [
    `<g transform="translate(${ox},${oy})">`,
    card
      ? `<rect width="${W}" height="${H}" rx="${radius}" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="${r1(Math.max(1, fs / 26))}"/>`
      : "",
    ...els,
    "</g>",
  ].join("\n");
  const scene: Scene = {
    width,
    height,
    background: card ? SURFACE : undefined,
    images: [{ img, x: ox, y: oy, radius }],
    overlay,
  };
  return { scene, fs, warnings, resolved, extended, offset: [ox, oy] };
}
