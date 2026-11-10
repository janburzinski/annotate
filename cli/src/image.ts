import { Resvg } from "@resvg/resvg-js";

export type Img = { href: string; width: number; height: number; bytes: Uint8Array; dpr?: number };

const PNG_SIG = 8;

/** Pixel density from a PNG pHYs chunk (macOS retina screenshots carry 144 dpi = 2x). */
function pngDpr(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = PNG_SIG; i + 12 <= b.length; ) {
    const len = v.getUint32(i);
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    if (type === "IDAT") return undefined;
    if (type === "pHYs" && b[i + 16] === 1) {
      const dpr = Math.round(((v.getUint32(i + 8) * 0.0254) / 72) * 2) / 2;
      return dpr >= 1 ? dpr : undefined;
    }
    i += 12 + len;
  }
}

/** Stamp the capture's device pixel ratio into the PNG so later renders size text the same way. */
export function withDpr(b: Uint8Array, dpr: number) {
  const data = new Uint8Array(9);
  const ppm = Math.round((dpr * 72) / 0.0254);
  new DataView(data.buffer).setUint32(0, ppm);
  new DataView(data.buffer).setUint32(4, ppm);
  data[8] = 1;
  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set(new TextEncoder().encode("pHYs"), 4);
  chunk.set(data, 8);
  cv.setUint32(17, Bun.hash.crc32(chunk.subarray(4, 17)));
  const ihdrEnd = PNG_SIG + 12 + new DataView(b.buffer, b.byteOffset).getUint32(PNG_SIG);
  return new Uint8Array([...b.subarray(0, ihdrEnd), ...chunk, ...b.subarray(ihdrEnd)]);
}

function dimensions(b: Uint8Array): [string, number, number] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] === 0x89 && b[1] === 0x50) return ["image/png", v.getUint32(16), v.getUint32(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return ["image/jpeg", v.getUint16(i + 7), v.getUint16(i + 5)];
      i += 2 + v.getUint16(i + 2);
    }
  }
  const tag = new TextDecoder().decode(b.slice(8, 16));
  if (tag === "WEBPVP8X")
    return ["image/webp", 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
  if (tag === "WEBPVP8 ") return ["image/webp", v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff];
  if (tag === "WEBPVP8L") {
    const n = v.getUint32(21, true);
    return ["image/webp", (n & 0x3fff) + 1, ((n >> 14) & 0x3fff) + 1];
  }
  throw new Error("unsupported image format (use PNG, JPEG or WebP)");
}

export async function loadImage(path: string): Promise<Img> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`image not found: ${path}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const [mime, width, height] = dimensions(bytes);
  const dpr = mime === "image/png" ? pngDpr(bytes) : undefined;
  return { href: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`, width, height, bytes, dpr };
}

export function pixels(img: Img): Uint8Array {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}"><image href="${img.href}" width="${img.width}" height="${img.height}"/></svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels;
}
