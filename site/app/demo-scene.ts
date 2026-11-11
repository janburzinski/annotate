// Server only: lays out the demo at build time, so the page ships with the screenshot and its notes in
// place and nothing pops in while the browser loads the engine. The browser's own run gives the same scene.
import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { parse } from "opentype.js";
import { annotate, setFont } from "../../cli/src/render";
import { DEMO_DPR, DEMO_NOTES, DEMOS, type Scheme, type View } from "./demo";

const file = (name: string) => readFileSync(path.join(process.cwd(), "public", name));

/** 8-bit, non-interlaced RGB or RGBA PNG to RGBA, which is all the demo screenshot needs. */
function decodePng(buf: Buffer) {
  let width = 0;
  let height = 0;
  let bpp = 0;
  const idat: Buffer[] = [];
  for (let i = 8; i < buf.length; ) {
    const n = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + n);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bpp = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (data[8] !== 8 || data[12] !== 0 || !bpp) throw new Error("demo.png must be 8-bit, non-interlaced RGB or RGBA");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    i += 12 + n;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let p = 0;
      if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) {
        const e = a + b - c;
        const da = Math.abs(e - a);
        const db = Math.abs(e - b);
        const dc = Math.abs(e - c);
        p = da <= db && da <= dc ? a : db <= dc ? b : c;
      }
      cur[x] = (line[x] + p) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      px[o] = cur[x * bpp];
      px[o + 1] = cur[x * bpp + 1];
      px[o + 2] = cur[x * bpp + 2];
      px[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    prev = cur;
  }
  return { width, height, px };
}

/** The screenshot's average colour, as a flat backdrop in the rare case the image is not there yet. */
function averageColor(img: { width: number; height: number; px: Uint8Array }) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < img.px.length; i += 4 * 97) {
    sum[0] += img.px[i];
    sum[1] += img.px[i + 1];
    sum[2] += img.px[i + 2];
    n++;
  }
  return `#${sum.map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`;
}

function scene(scheme: Scheme): View {
  const { src } = DEMOS[scheme];
  const img = decodePng(file(src.slice(1)));
  const t0 = performance.now();
  const a = annotate({ ...img, dpr: DEMO_DPR }, DEMO_NOTES, { dpr: DEMO_DPR });
  return {
    width: a.scene.width,
    height: a.scene.height,
    background: a.scene.background,
    overlay: a.scene.overlay,
    fs: a.fs,
    offset: [a.offset[0], a.offset[1]],
    radius: a.scene.images[0].radius ?? 0,
    image: { src, width: img.width, height: img.height, fill: averageColor(img) },
    resolved: a.resolved,
    warnings: a.warnings,
    ms: performance.now() - t0,
  };
}

let cached: Record<Scheme, View> | undefined;
/** The demo laid out on both screenshots; the page shows the one for the visitor's theme. */
export function demoScenes(): Record<Scheme, View> {
  if (cached) return cached;
  const font = file("poah.ttf");
  setFont(parse(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength)));
  cached = { light: scene("light"), dark: scene("dark") };
  return cached;
}
