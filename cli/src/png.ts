import { deflateSync } from "node:zlib";

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

/** Straight-alpha RGBA to PNG: "up" filter and zlib level 3, smaller than resvg's at about its speed. */
export function encodePng(px: Uint8Array, w: number, h: number, dpr?: number) {
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
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  if (dpr) {
    const phys = new Uint8Array(9);
    const ppm = Math.round((dpr * 72) / 0.0254);
    new DataView(phys.buffer).setUint32(0, ppm);
    new DataView(phys.buffer).setUint32(4, ppm);
    phys[8] = 1;
    parts.push(chunk("pHYs", phys));
  }
  parts.push(chunk("IDAT", deflateSync(raw, { level: 3 })), chunk("IEND", new Uint8Array()));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function withDprChunk(b: Uint8Array, dpr: number) {
  const phys = new Uint8Array(9);
  const ppm = Math.round((dpr * 72) / 0.0254);
  new DataView(phys.buffer).setUint32(0, ppm);
  new DataView(phys.buffer).setUint32(4, ppm);
  phys[8] = 1;
  const ihdrEnd = 8 + 12 + new DataView(b.buffer, b.byteOffset).getUint32(8);
  const c = chunk("pHYs", phys);
  const out = new Uint8Array(b.length + c.length);
  out.set(b.subarray(0, ihdrEnd));
  out.set(c, ihdrEnd);
  out.set(b.subarray(ihdrEnd), ihdrEnd + c.length);
  return out;
}

/** Write via a temp file and rename, so readers and parallel runs never see a half-written PNG. */
export async function writeAtomic(path: string, data: Uint8Array) {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await Bun.write(tmp, data);
  const { renameSync } = await import("node:fs");
  renameSync(tmp, path);
}
