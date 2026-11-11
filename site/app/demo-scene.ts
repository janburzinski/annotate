// Server only: lays out the demo at build time, so the page ships with the screenshot and its notes in
// place and nothing pops in while the browser loads the engine. The browser's own run gives the same scene.
import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { parse } from "opentype.js";
import { annotate, setFont } from "../../cli/src/render";
import { DEMO, DEMO_NOTES, type View } from "./demo";

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

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A tiny box-averaged copy as a PNG data URL: the browser scales it up blurry until the real image loads. */
function placeholder(img: { width: number; height: number; px: Uint8Array }, w = 32) {
  const h = Math.max(1, Math.round((img.height / img.width) * w));
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sum = [0, 0, 0];
      let n = 0;
      for (let sy = Math.floor((y * img.height) / h); sy < Math.floor(((y + 1) * img.height) / h); sy += 4)
        for (let sx = Math.floor((x * img.width) / w); sx < Math.floor(((x + 1) * img.width) / w); sx += 4) {
          const o = (sy * img.width + sx) * 4;
          sum[0] += img.px[o];
          sum[1] += img.px[o + 1];
          sum[2] += img.px[o + 2];
          n++;
        }
      for (let k = 0; k < 3; k++) raw[y * (w * 3 + 1) + 1 + x * 3 + k] = Math.round(sum[k] / Math.max(1, n));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

let cached: View | undefined;
export function demoScene(): View {
  if (cached) return cached;
  const font = file("poah.ttf");
  setFont(parse(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength)));
  const img = decodePng(file("demo.png"));
  const t0 = performance.now();
  const a = annotate({ ...img, dpr: DEMO.dpr }, DEMO_NOTES, { dpr: DEMO.dpr });
  cached = {
    width: a.scene.width,
    height: a.scene.height,
    background: a.scene.background,
    overlay: a.scene.overlay,
    fs: a.fs,
    offset: [a.offset[0], a.offset[1]],
    radius: a.scene.images[0].radius ?? 0,
    image: { src: DEMO.src, width: img.width, height: img.height, placeholder: placeholder(img) },
    resolved: a.resolved,
    warnings: a.warnings,
    ms: performance.now() - t0,
  };
  return cached;
}
