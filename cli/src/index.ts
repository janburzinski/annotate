#!/usr/bin/env bun
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { capture } from "./capture";
import { compare, grid, resolvePath, sceneToPng, toPng } from "./compose";
import { loadImage } from "./image";
import { annotate, DEFAULT_COLOR } from "./render";
import type { CaptureSpec, CompareSpec, RenderSpec } from "./types";
import { writeAtomic } from "./png";
import { checkSpec, parseRegion, parseStep } from "./validate";

const USAGE = `annotate: handwritten (Poah) notes and arrows on screenshots

  annotate <spec.json | ->        render a spec (read it from stdin with -)
  annotate grid <image>           pixel rulers, for reading coordinates off any image
      --step <px>                 ruler spacing (automatic by default)
      --region x,y,w,h            zoom into one area for precise boxes

  --out <path>                    output path, relative to the current directory
  --frame                         always show the screenshot as a rounded card

Spec kinds (picked by their keys):
  { "image", "notes" }                              annotate an existing screenshot
  { "url", "notes": [{ "target": "<selector>" }] }  capture with headless Chromium, then annotate
  { "before", "after" }                             compare two images or captures

Note: { "text", "to": [x,y] | [x,y,w,h], "at"?: [x,y] | "left|right|above|below",
        "mark"?: "circle|underline|box", "bend"?: 0.12, "arrow"?: true, "wrap"?: 11, "color"? }
Spec-wide: "color" (default ${DEFAULT_COLOR} on light, lighter on dark), "size", "dpr", "frame".
Capture: "clip", "padding", "viewport", "dpr", "colorScheme", "wait", "script", "storageState", "insecure".
See SKILL.md for the full guide.`;

const args = () =>
  parseArgs({
    allowPositionals: true,
    allowNegative: true,
    options: {
      out: { type: "string" },
      step: { type: "string" },
      region: { type: "string" },
      frame: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

/** Never let an output path overwrite one of the inputs, also through symlinks. */
function guardOut(out: string, inputs: string[]) {
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const o = real(out);
  if (inputs.some((i) => real(i) === o)) throw new Error(`output ${out} would overwrite an input image`);
}

async function main() {
  let parsed: ReturnType<typeof args>;
  try {
    parsed = args();
  } catch (e) {
    throw new Error(`${(e as Error).message.split("\n")[0]} (see annotate --help)`);
  }
  const { values, positionals } = parsed;
  const [first, second] = positionals;
  if (values.help || !first) return console.log(USAGE);

  if (first === "grid") {
    if (!second) throw new Error("usage: annotate grid <image>");
    const img = await loadImage(second);
    const region = parseRegion(values.region, img.width, img.height);
    const g = grid(img, parseStep(values.step), region);
    const suffix = region ? `.grid-${region.join("-")}.png` : ".grid.png";
    const out = values.out ?? second.replace(/(\.\w+)?$/, suffix);
    guardOut(out, [second]);
    await writeAtomic(out, toPng(g.width, g.height, g.body, true));
    return report({
      out: resolve(out),
      image: { width: img.width, height: img.height, dpr: img.dpr ?? null },
      step: g.step,
      note: "ruler numbers are original image pixels; use them directly in `to`",
    });
  }

  if (first !== "-" && !(await Bun.file(first).exists())) throw new Error(`spec not found: ${first}`);
  const raw = first === "-" ? await Bun.stdin.text() : await Bun.file(first).text();
  let spec: Partial<RenderSpec & CompareSpec & CaptureSpec>;
  try {
    spec = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${first === "-" ? "stdin" : first} is not valid JSON (${(e as Error).message})`);
  }
  checkSpec(spec);
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
    const out = values.out ? resolve(values.out) : resolvePath(base, cs.out ?? "compare.png");
    const sides = [
      await side(cs.before, out.replace(/(\.\w+)?$/, ".before.png")),
      await side(cs.after, out.replace(/(\.\w+)?$/, ".after.png")),
    ];
    guardOut(out, sides.map((x) => x.image));
    const c = await compare(cs, sides, sides[0].dpr);
    await writeAtomic(out, sceneToPng(c.scene));
    return report({ out, width: c.scene.width, height: c.scene.height, warnings: c.warnings, resolved: c.resolved });
  }

  const isCapture = typeof spec.url === "string";
  const fallback = isCapture ? "capture.png" : String(spec.image).replace(/(\.\w+)?$/, ".annotated.png");
  const out = values.out ? resolve(values.out) : resolvePath(base, spec.out ?? fallback);
  if (!isCapture) guardOut(out, [resolvePath(base, spec.image as string)]);
  const r = await side(spec as RenderSpec | CaptureSpec, out);
  const img = await loadImage(r.image);
  const a = annotate(
    img,
    r.notes ?? [],
    { color: r.color, size: r.size, dpr: r.dpr },
    framed ? { card: true, pad: 1.2 } : {},
  );
  await writeAtomic(out, sceneToPng(a.scene));
  report({
    out,
    width: a.scene.width,
    height: a.scene.height,
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
  // One line, always: library errors append call logs and stack details.
  console.error(`annotate: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  process.exit(1);
});
