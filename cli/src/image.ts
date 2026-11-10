import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { encodePng, withDprChunk } from "./png";

export type Img = { href: string; width: number; height: number; bytes: Uint8Array; dpr?: number; px?: Uint8Array };

type Format = "png" | "jpeg" | "webp" | "other";

function sniff(b: Uint8Array): Format {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "webp";
  return "other";
}

const has = (b: Uint8Array, seq: number[], from: number) => {
  for (let i = Math.max(0, from); i <= b.length - seq.length; i++) if (seq.every((v, k) => b[i + k] === v)) return true;
  return false;
};

/** Pixel density from a PNG pHYs chunk (macOS retina screenshots carry 144 dpi = 2x). */
function pngDpr(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 8; i + 12 <= b.length; ) {
    const len = v.getUint32(i);
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    if (type === "IDAT") return undefined;
    if (type === "pHYs" && b[i + 16] === 1) {
      const dpr = Math.round(((v.getUint32(i + 8) * 0.0254) / 72) * 2) / 2;
      // Above 4x is a print or scanner setting, not a screen.
      return dpr >= 1 && dpr <= 4 ? dpr : undefined;
    }
    i += 12 + len;
  }
}

/** Stamp the capture's device pixel ratio into the PNG so later renders size text the same way. */
export const withDpr = withDprChunk;

/** Frame size and EXIF orientation of a JPEG. */
function jpegInfo(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let orientation = 1;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    const len = v.getUint16(i + 2);
    if (m === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 8)) === "Exif") {
      const t = i + 10;
      const le = b[t] === 0x49;
      const u16 = (o: number) => v.getUint16(t + o, le);
      const u32 = (o: number) => v.getUint32(t + o, le);
      if (t + 8 < b.length) {
        const ifd = u32(4);
        const n = t + ifd + 2 < b.length ? u16(ifd) : 0;
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          if (t + e + 10 > b.length) break;
          if (u16(e) === 0x0112) orientation = u16(e + 8);
        }
      }
    }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { width: v.getUint16(i + 7), height: v.getUint16(i + 5), orientation };
    i += 2 + len;
  }
  throw new Error("JPEG has no frame header");
}

function decode(href: string, w: number, h: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><image href="${href}" width="${w}" height="${h}"/></svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels as Uint8Array;
}

/** resvg draws nothing when it cannot decode an image, so an all-transparent result means failure. */
function blank(px: Uint8Array) {
  for (let i = 3; i < px.length; i += 4 * 97) if (px[i] !== 0) return false;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return false;
  return true;
}

/** Convert anything resvg cannot read (WebP, CMYK JPEG, HEIC, GIF, TIFF) with a tool on the machine. */
async function convert(path: string, why: string) {
  const dir = mkdtempSync(join(tmpdir(), "annotate-"));
  const out = join(dir, "converted.png");
  const tools: string[][] = [
    ["sips", "-s", "format", "png", path, "--out", out],
    ["magick", path, `png32:${out}`],
    ["convert", path, `png32:${out}`],
    ["dwebp", path, "-o", out],
  ];
  try {
    for (const cmd of tools) {
      if (!Bun.which(cmd[0])) continue;
      const p = Bun.spawnSync(cmd, { stdout: "ignore", stderr: "ignore" });
      if (p.exitCode === 0 && existsSync(out)) return new Uint8Array(await Bun.file(out).arrayBuffer());
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  throw new Error(`${why}; convert it to PNG first (no sips, ImageMagick or dwebp found to do it)`);
}

/** Rotate or flip decoded pixels so EXIF orientation 2-8 displays upright. */
function orient(px: Uint8Array, w: number, h: number, o: number) {
  const swap = o >= 5;
  const W = swap ? h : w;
  const H = swap ? w : h;
  const out = new Uint8Array(W * H * 4);
  const aligned = px.byteOffset % 4 ? new Uint8Array(px) : px;
  const src = new Uint32Array(aligned.buffer, aligned.byteOffset, w * h);
  const dst = new Uint32Array(out.buffer);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sx: number;
      let sy: number;
      if (o === 2) [sx, sy] = [w - 1 - x, y];
      else if (o === 3) [sx, sy] = [w - 1 - x, h - 1 - y];
      else if (o === 4) [sx, sy] = [x, h - 1 - y];
      else if (o === 5) [sx, sy] = [y, x];
      else if (o === 6) [sx, sy] = [y, h - 1 - x];
      else if (o === 7) [sx, sy] = [w - 1 - y, h - 1 - x];
      else [sx, sy] = [w - 1 - y, x];
      dst[y * W + x] = src[sy * w + sx];
    }
  return { px: out, width: W, height: H };
}

const fromPng = (bytes: Uint8Array, px: Uint8Array, width: number, height: number, dpr?: number): Img => ({
  href: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
  width,
  height,
  bytes,
  dpr,
  px,
});

/**
 * Load and decode an image once. Truncated files fail loudly, EXIF rotation is applied, and
 * formats resvg cannot decode are converted with a system tool instead of rendering blank.
 */
export async function loadImage(path: string, converted = false): Promise<Img> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`image not found: ${path}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 16) throw new Error(`${path} is not an image`);
  const fmt = sniff(bytes);
  const name = path.split("/").pop();

  if (fmt === "png") {
    if (!has(bytes, [0x49, 0x45, 0x4e, 0x44], bytes.length - 64)) throw new Error(`${name} looks truncated (no PNG end marker)`);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const [width, height] = [v.getUint32(16), v.getUint32(20)];
    const href = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    const px = decode(href, width, height);
    if (blank(px)) {
      if (converted) throw new Error(`${name} could not be decoded (or is fully transparent)`);
      return reload(await convert(path, `${name} could not be decoded`));
    }
    return { href, width, height, bytes, dpr: pngDpr(bytes), px };
  }
  if (fmt === "jpeg") {
    if (!has(bytes, [0xff, 0xd9], bytes.length - 32)) throw new Error(`${name} looks truncated (no JPEG end marker)`);
    const { width, height, orientation } = jpegInfo(bytes);
    const href = `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
    let px = decode(href, width, height);
    if (blank(px)) return reload(await convert(path, `${name} could not be decoded (CMYK JPEGs are not supported)`));
    if (orientation < 2 || orientation > 8) return { href, width, height, bytes, px };
    // Phones store photos sideways and record the turn in EXIF; bake it in so coordinates match.
    const r = orient(px, width, height, orientation);
    px = r.px;
    return fromPng(encodePng(px, r.width, r.height), px, r.width, r.height);
  }
  const kind = fmt === "webp" ? "WebP" : "this format";
  if (converted) throw new Error(`${name} could not be decoded`);
  return reload(await convert(path, `${name}: ${kind} cannot be read directly`));
}

async function reload(png: Uint8Array) {
  const dir = mkdtempSync(join(tmpdir(), "annotate-"));
  try {
    await Bun.write(join(dir, "image.png"), png);
    return await loadImage(join(dir, "image.png"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Decoded RGBA (premultiplied), shared by analysis and the final render. */
export function pixels(img: Img): Uint8Array {
  if (!img.px) img.px = decode(img.href, img.width, img.height);
  return img.px;
}
