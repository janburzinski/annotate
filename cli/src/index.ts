#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { capture } from "./capture";
import { compare, grid, resolvePath, toPng } from "./compose";
import { loadImage } from "./image";
import { annotate, DEFAULT_COLOR } from "./render";
import type { CaptureSpec, CompareSpec, RenderSpec } from "./types";

const USAGE = `annotate: handwritten (Poah) notes and arrows on screenshots

  annotate <spec.json | ->        render a spec (stdin with -)
  annotate grid <image>           overlay a pixel grid to read coordinates
      --step <px>                 grid spacing (auto by default)
      --region x,y,w,h            zoom into part of the image for precise boxes

  --out <path>                    override the output path
  --frame                         put the result on a rounded card

Spec kinds (picked by their keys):
  { "image", "notes" }            annotate a screenshot
  { "before", "after" }           side-by-side before/after
  { "url", "notes": [{ "target": "<selector>" }] }   capture with Chrome, then annotate

Note: { "text", "to": [x,y] | [x,y,w,h], "at"?: [x,y] | "left|right|above|below",
        "mark"?: "circle|underline|box", "bend"?: 0.12, "arrow"?: true, "wrap"?: 13, "color"? }
Spec-wide: "color" (default ${DEFAULT_COLOR}), "size" (font px), "dpr", "frame".
See SKILL.md for the full guide.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    step: { type: "string" },
    region: { type: "string" },
    frame: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

async function main() {
  const [first, second] = positionals;
  if (values.help || !first) return console.log(USAGE);

  if (first === "grid") {
    if (!second) throw new Error("usage: annotate grid <image>");
    const img = await loadImage(second);
    const region = values.region?.split(",").map(Number);
    if (region && (region.length !== 4 || region.some(Number.isNaN))) throw new Error("--region must be x,y,w,h");
    const g = grid(img, values.step ? Number(values.step) : undefined, region);
    const suffix = region ? `.grid-${region.join("-")}.png` : ".grid.png";
    const out = values.out ?? second.replace(/(\.\w+)?$/, suffix);
    await Bun.write(out, toPng(g.width, g.height, g.body, true));
    return report({
      out: resolve(out),
      image: { width: img.width, height: img.height, dpr: img.dpr ?? null },
      step: g.step,
      note: "ruler numbers are original image pixels; use them directly in `to`",
    });
  }

  const raw = first === "-" ? await Bun.stdin.text() : await Bun.file(first).text();
  const spec = JSON.parse(raw);
  const base = first === "-" ? process.cwd() : dirname(resolve(first));
  const framed = values.frame ?? spec.frame;

  /** Turn a capture spec into a plain { image, notes } by taking the screenshot first. */
  const side = async (s: RenderSpec | CaptureSpec | string, out: string): Promise<RenderSpec> => {
    if (typeof s === "string") return { image: resolvePath(base, s) };
    if (!("url" in s)) {
      if (!s.image) throw new Error('spec needs "image", "url", or "before"/"after"');
      return { ...s, image: resolvePath(base, s.image) };
    }
    const shot = out.replace(/(\.\w+)?$/, ".raw.png");
    // A bare path is a local HTML file, relative to the spec like every other path.
    const url = /^[a-z][\w+.-]*:/i.test(s.url) ? s.url : `file://${resolvePath(base, s.url)}`;
    const { notes, dpr } = await capture(
      { ...s, url, storageState: s.storageState && resolvePath(base, s.storageState) },
      shot,
    );
    return { image: shot, notes, dpr, color: s.color, size: s.size, frame: s.frame };
  };

  if ("before" in spec || "after" in spec) {
    const cs = spec as CompareSpec;
    const out = resolvePath(base, values.out ?? cs.out ?? "compare.png");
    const sides = [
      await side(cs.before, out.replace(/(\.\w+)?$/, ".before.png")),
      await side(cs.after, out.replace(/(\.\w+)?$/, ".after.png")),
    ];
    const c = await compare(cs, sides, sides[0].dpr);
    await Bun.write(out, toPng(c.width, c.height, c.body));
    return report({ out, width: c.width, height: c.height, warnings: c.warnings, resolved: c.resolved });
  }

  const fallback = "url" in spec ? "capture.png" : String(spec.image).replace(/(\.\w+)?$/, ".annotated.png");
  const out = resolvePath(base, values.out ?? spec.out ?? fallback);
  const r = await side(spec, out);
  const img = await loadImage(r.image);
  const a = annotate(
    img,
    r.notes ?? [],
    { color: r.color, size: r.size, dpr: r.dpr },
    framed ? { card: true, pad: 1.2 } : {},
  );
  await Bun.write(out, toPng(a.width, a.height, a.body));
  report({
    out,
    width: a.width,
    height: a.height,
    fontSize: a.fs,
    extended: a.extended,
    warnings: a.warnings,
    resolved: { image: r.image, dpr: r.dpr ?? img.dpr, notes: a.resolved },
  });
}

function report(o: Record<string, unknown>) {
  const json = JSON.stringify(
    o,
    (_, v) => (Array.isArray(v) && v.every((n) => typeof n === "number") ? `[${v.join(", ")}]` : v),
    2,
  );
  console.log(json.replace(/"\[([\d., -]*)\]"/g, "[$1]"));
}

main().catch((e) => {
  console.error(`annotate: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
