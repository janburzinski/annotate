import { existsSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { type Img, loadImage } from "./image";
import { FONT_PATH } from "./font";
import { annotate, DEFAULT_COLOR, esc, fontSize, SURFACE } from "./render";
import { renderScene } from "./raster";
import type { CompareSpec, ImageSpec, Layer, Scene, Style } from "./types";

// Grid rulers read best in a monospace font; load that one file instead of every system font.
const MONO = ["/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"].filter((f) =>
  existsSync(f),
);

export function toPng(width: number, height: number, body: string, mono = false) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">\n${body}\n</svg>`;
  return new Resvg(svg, {
    font: { fontFiles: mono ? [FONT_PATH, ...MONO] : [FONT_PATH], loadSystemFonts: false, defaultFontFamily: "Poah" },
  })
    .render()
    .asPng();
}

export const sceneToPng = (scene: Scene) => renderScene(scene, [FONT_PATH]);

export async function compare(spec: CompareSpec, specs: ImageSpec[], dpr?: number) {
  const imgs: Img[] = await Promise.all(specs.map((s) => loadImage(s.image)));
  const style: Partial<Style> = { color: spec.color, size: spec.size, dpr: spec.dpr ?? dpr ?? imgs[0].dpr };
  const fs = fontSize(Math.max(imgs[0].width, imgs[1].width), Math.max(imgs[0].height, imgs[1].height), style);
  const panels = imgs.map((img, i) => annotate(img, specs[i].notes ?? [], style, { fs, card: true }));

  const sz = panels.map((p) => [p.scene.width, p.scene.height]);
  const ratio = (sz[0][0] + sz[1][0]) / Math.max(sz[0][1], sz[1][1]);
  const column = spec.layout === "column" || (spec.layout !== "row" && ratio > 2.6);
  // Panels are never scaled (that would fake a difference). Along the stacking direction the
  // screenshots share one offset, so the two UIs line up exactly.
  const axis = column ? 0 : 1;
  const lead = Math.max(...panels.map((p) => p.offset[axis]));
  const trail = Math.max(...panels.map((p, i) => sz[i][axis] - p.offset[axis]));
  const share = lead + trail;

  const pad = Math.round(fs * 0.8);
  const gap = Math.round(fs * 0.8);
  const title = Math.round(fs * 1.6);
  const labels = spec.labels ?? ["before", "after"];
  const color = spec.color ?? DEFAULT_COLOR;
  const parts: string[] = [];
  const images: Layer[] = [];
  let x = pad;
  let y = pad;
  for (const [i, p] of panels.entries()) {
    const shift = lead - p.offset[axis];
    const px = x + (column ? shift : 0);
    const py = y + title + (column ? 0 : shift);
    for (const l of p.scene.images) images.push({ ...l, x: l.x + px, y: l.y + py });
    parts.push(
      `<svg x="${px}" y="${py}" width="${p.scene.width}" height="${p.scene.height}">${p.scene.overlay}</svg>`,
      `<text x="${px + p.offset[0]}" y="${py + p.offset[1] - fs * 0.5}" font-family="Poah" font-size="${Math.round(fs * 1.3)}" fill="${color}">${esc(labels[i])}</text>`,
    );
    if (column) y += title + p.scene.height + gap;
    else x += p.scene.width + gap;
  }
  const width = Math.ceil(column ? share + pad * 2 : x - gap + pad);
  const height = Math.ceil(column ? y - gap + pad : share + title + pad * 2);
  const scene: Scene = { width, height, background: SURFACE, images, overlay: parts.join("\n") };
  return {
    scene,
    warnings: panels.flatMap((p, i) => p.warnings.map((w) => `${labels[i]}: ${w}`)),
    resolved: {
      before: { image: specs[0].image, notes: panels[0].resolved },
      after: { image: specs[1].image, notes: panels[1].resolved },
      dpr: style.dpr,
      color: spec.color,
      labels: spec.labels,
      layout: spec.layout,
    },
  };
}

/**
 * Rulers outside the image (so nothing is covered) plus faint lines across it. Ruler numbers are
 * always original image pixels; `region` crops to [x, y, w, h] and zooms in for precise reading.
 */
export function grid(img: Img, step?: number, region?: number[]) {
  const [rx, ry, rw, rh] = region ?? [0, 0, img.width, img.height];
  const k = region ? Math.min(4, 1100 / Math.max(rw, rh)) : 1;
  const W = rw * k;
  const H = rh * k;
  const s = step ?? ([5, 10, 20, 25, 50, 100, 200, 250, 500].find((n) => Math.max(rw, rh) / n <= 20) ?? 500);
  const fs = Math.max(14, Math.round(Math.max(W, H) / 60));
  const m = Math.round(fs * 3.4);
  const ink = "#e11d48";
  const parts = [
    `<rect width="${W + m}" height="${H + m}" fill="#fff"/>`,
    `<svg x="${m}" y="${m}" width="${W}" height="${H}" viewBox="${rx} ${ry} ${rw} ${rh}"><image href="${img.href}" width="${img.width}" height="${img.height}"/></svg>`,
  ];
  const text = (x: number, y: number, t: number, anchor: string) =>
    `<text x="${x}" y="${y}" font-size="${fs}" font-family="Menlo, monospace" fill="${ink}" text-anchor="${anchor}">${t}</text>`;
  const first = (o: number) => Math.ceil(o / s) * s;
  for (let v = first(rx); v <= rx + rw; v += s) {
    const x = m + (v - rx) * k;
    parts.push(
      `<line x1="${x}" y1="${m * 0.62}" x2="${x}" y2="${m + H}" stroke="${ink}" stroke-opacity="0.45"/>`,
      `<line x1="${x + (s * k) / 2}" y1="${m}" x2="${x + (s * k) / 2}" y2="${m + H}" stroke="${ink}" stroke-opacity="0.15" stroke-dasharray="3 5"/>`,
      text(x, m * 0.5, v, "middle"),
    );
  }
  for (let v = first(ry); v <= ry + rh; v += s) {
    const y = m + (v - ry) * k;
    parts.push(
      `<line x1="${m * 0.78}" y1="${y}" x2="${m + W}" y2="${y}" stroke="${ink}" stroke-opacity="0.45"/>`,
      `<line x1="${m}" y1="${y + (s * k) / 2}" x2="${m + W}" y2="${y + (s * k) / 2}" stroke="${ink}" stroke-opacity="0.15" stroke-dasharray="3 5"/>`,
      text(m * 0.7, y + fs * 0.35, v, "end"),
    );
  }
  return { width: Math.ceil(W + m), height: Math.ceil(H + m), body: parts.join("\n"), step: s };
}

export function resolvePath(base: string, p: string) {
  return p.startsWith("/") ? p : `${base}/${p}`;
}
