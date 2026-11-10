import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { type Img, pixels } from "./image";

/** A screenshot placed on the canvas at whole pixels, never resampled. */
export type Layer = { img: Img; x: number; y: number; radius: number };

/**
 * What a render is made of: an optional flat background, screenshots, and vector markup on top.
 * Screenshots are blitted from the pixels decoded for analysis, so each PNG is decoded once;
 * resvg only rasterises the notes and arrows.
 */
export type Scene = {
  width: number;
  height: number;
  background?: string;
  images: Layer[];
  overlay: string;
};

const hex = (c: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) throw new Error(`background must be #rrggbb, got ${c}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

/** Coverage of a pixel by a rounded rectangle's corner (1 inside, 0 outside, antialiased edge). */
function corner(x: number, y: number, w: number, h: number, r: number) {
  const cx = x < r ? r : x >= w - r ? w - r : -1;
  const cy = y < r ? r : y >= h - r ? h - r : -1;
  if (cx < 0 || cy < 0) return 1;
  const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
  return Math.min(1, Math.max(0, r - d + 0.5));
}

function blit(canvas: Uint8Array, W: number, H: number, l: Layer, bg: readonly number[] | undefined) {
  const src = pixels(l.img);
  const w = l.img.width;
  const h = l.img.height;
  const r = Math.max(0, Math.min(l.radius, w / 2, h / 2));
  for (let y = 0; y < h; y++) {
    const cy = y + l.y;
    if (cy < 0 || cy >= H) continue;
    const x0 = Math.max(0, -l.x);
    const x1 = Math.min(w, W - l.x);
    if (x1 <= x0) continue;
    const s = (y * w + x0) * 4;
    const d = (cy * W + l.x + x0) * 4;
    const roundRow = r > 0 && (y < r || y >= h - r);
    if (!roundRow && !bg) {
      canvas.set(src.subarray(s, s + (x1 - x0) * 4), d);
      for (let i = 3; i < (x1 - x0) * 4; i += 4) {
        const sa = src[s + i];
        if (sa === 255) continue;
        for (let k = 1; k <= 3; k++) canvas[d + i - k] = sa ? Math.round((src[s + i - k] * 255) / sa) : 0;
      }
      continue;
    }
    if (!roundRow && bg) {
      canvas.set(src.subarray(s, s + (x1 - x0) * 4), d);
      // Transparent screenshot pixels sit on the background.
      for (let i = 3; i < (x1 - x0) * 4; i += 4) if (src[s + i] < 255) over(canvas, d + i - 3, src, s + i - 3, bg);
      continue;
    }
    for (let x = x0; x < x1; x++) {
      const si = (y * w + x) * 4;
      const di = (cy * W + l.x + x) * 4;
      const cov = r > 0 ? corner(x, y, w, h, r) : 1;
      if (cov <= 0) continue;
      const a = (src[si + 3] / 255) * cov;
      if (bg) {
        for (let k = 0; k < 3; k++) canvas[di + k] = Math.round(src[si + k] * cov + bg[k] * (1 - a));
        canvas[di + 3] = 255;
      } else {
        // No background: keep the screenshot's own transparency, un-premultiplied.
        const sa = src[si + 3];
        for (let k = 0; k < 3; k++) canvas[di + k] = sa ? Math.round((src[si + k] * 255) / sa) : 0;
        canvas[di + 3] = Math.round(sa * cov);
      }
    }
  }
}

/** Premultiplied source pixel over an opaque background colour. */
function over(canvas: Uint8Array, d: number, src: Uint8Array, s: number, bg: readonly number[]) {
  const ia = 1 - src[s + 3] / 255;
  for (let k = 0; k < 3; k++) canvas[d + k] = Math.round(src[s + k] + bg[k] * ia);
  canvas[d + 3] = 255;
}

/** Premultiplied overlay onto a straight-alpha canvas. */
function composite(canvas: Uint8Array, top: Uint8Array) {
  for (let i = 0; i < top.length; i += 4) {
    const sa = top[i + 3];
    if (sa === 0) continue;
    const da = canvas[i + 3];
    if (sa === 255 || da === 0) {
      if (sa === 255) {
        canvas[i] = top[i];
        canvas[i + 1] = top[i + 1];
        canvas[i + 2] = top[i + 2];
      } else for (let k = 0; k < 3; k++) canvas[i + k] = Math.round((top[i + k] * 255) / sa);
      canvas[i + 3] = sa;
      continue;
    }
    const ia = 1 - sa / 255;
    if (da === 255) {
      for (let k = 0; k < 3; k++) canvas[i + k] = Math.round(top[i + k] + canvas[i + k] * ia);
      continue;
    }
    const oa = sa + da * ia;
    for (let k = 0; k < 3; k++) canvas[i + k] = Math.round((top[i + k] * 255 + canvas[i + k] * da * ia) / oa);
    canvas[i + 3] = Math.round(oa);
  }
}

const crc = (b: Uint8Array) => Bun.hash.crc32(b) >>> 0;
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGBA to PNG: "up" filter and zlib level 3 beat resvg's encoder on size at about the same speed. */
export function encodePng(px: Uint8Array, w: number, h: number) {
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    const r = y * stride;
    raw[o] = 2;
    if (y === 0) raw.set(px.subarray(0, stride), 1);
    else for (let x = 0; x < stride; x++) raw[o + 1 + x] = px[r + x] - px[r - stride + x];
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 3 })),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function renderScene(scene: Scene, fontFiles: string[]) {
  const { width: W, height: H } = scene;
  const canvas = new Uint8Array(W * H * 4);
  const bg = scene.background ? hex(scene.background) : undefined;
  if (bg) new Uint32Array(canvas.buffer).fill(new Uint32Array(new Uint8Array([bg[0], bg[1], bg[2], 255]).buffer)[0]);
  for (const l of scene.images) blit(canvas, W, H, l, bg);
  if (scene.overlay.trim()) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">\n${scene.overlay}\n</svg>`;
    const top = new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Poah" } }).render();
    composite(canvas, top.pixels);
  }
  return encodePng(canvas, W, H);
}
