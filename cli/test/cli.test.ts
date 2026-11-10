import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { findBrowser } from "../src/capture";
import { loadImage, pixels } from "../src/image";

const CLI = join(import.meta.dir, "../src/index.ts");
let dir: string;

const ui = (w: number, h: number, bg = "#f7f7f7") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${Array.from(
    { length: 9 },
    (_, i) => `<rect x="${w * 0.2}" y="${40 + i * 95}" width="${w * 0.6}" height="30" rx="6" fill="#fff" stroke="#ddd"/>`,
  ).join("")}</svg>`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "annotate-test-"));
  const png = (name: string, svg: string) => Bun.write(join(dir, name), new Resvg(svg).render().asPng());
  await png("shot.png", ui(1400, 900));
  await png("dark.png", ui(1400, 900, "#111111"));
  await png("alpha.png", `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect x="50" y="50" width="200" height="80" fill="#36f"/></svg>`);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function run(spec: unknown, ...args: string[]) {
  const file = join(dir, `spec-${Math.random().toString(36).slice(2)}.json`);
  if (spec !== undefined) await Bun.write(file, JSON.stringify(spec));
  const p = Bun.spawn(["bun", CLI, ...(spec !== undefined ? [file] : []), ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code, json: code === 0 && out.trim().startsWith("{") ? JSON.parse(out) : null, err: err.trim() };
}

const note = (text: string, extra: object = {}) => ({ text, to: [560, 100, 300, 30], ...extra });

describe("renders", () => {
  test("a screenshot with notes, without warnings", async () => {
    const r = await run({ image: "shot.png", out: "a.png", notes: [note("first note"), { text: "second", to: [560, 420, 300, 30], mark: "circle" }] });
    expect(r.code).toBe(0);
    expect(r.json.warnings).toEqual([]);
    const img = await loadImage(r.json.out);
    expect(img.width).toBeGreaterThanOrEqual(1400);
  });

  test("keeps the screenshot pixel-exact under the notes", async () => {
    const r = await run({ image: "shot.png", out: "exact.png", notes: [] });
    const [a, b] = await Promise.all([loadImage(join(dir, "shot.png")), loadImage(r.json.out)]);
    expect(Buffer.compare(Buffer.from(pixels(a)), Buffer.from(pixels(b)))).toBe(0);
  });

  test("preserves transparency when nothing spills outside", async () => {
    const r = await run({ image: "alpha.png", out: "alpha-out.png", notes: [] });
    const px = pixels(await loadImage(r.json.out));
    expect(px[3]).toBe(0);
  });

  test("escapes markup in notes and labels", async () => {
    const r = await run({ out: "c.png", before: "shot.png", after: { image: "dark.png", notes: [note(`<b>&"x"`)] }, labels: ["<a>", "b & c"] });
    expect(r.code).toBe(0);
  });

  test("widens very long notes and warns", async () => {
    const r = await run({ image: "shot.png", out: "long.png", notes: [note("word ".repeat(200))] });
    expect(r.code).toBe(0);
    expect(r.json.warnings.join()).toContain("notes read best");
  });

  test("reports arrows that run through other labels", async () => {
    const notes = Array.from({ length: 30 }, (_, i) => ({ text: `note number ${i}`, to: [300 + (i % 6) * 140, 60 + Math.floor(i / 6) * 160, 60, 20] }));
    const r = await run({ image: "shot.png", out: "crowd.png", notes });
    expect(r.code).toBe(0);
    expect(r.json.warnings.length).toBeGreaterThan(0);
  });
});

describe("rejects bad input with a clear message", () => {
  const cases: [string, unknown][] = [
    ["empty text", { image: "shot.png", notes: [note(" ")] }],
    ["non-numeric to", { image: "shot.png", notes: [{ text: "x", to: ["1", 2, 3, 4] }] }],
    ["unknown mark", { image: "shot.png", notes: [note("x", { mark: "star" })] }],
    ["unsafe colour", { image: "shot.png", notes: [note("x", { color: `red" onload="x` })] }],
    ["target outside the image", { image: "shot.png", notes: [{ text: "x", to: [9000, 9000, 10, 10] }] }],
    ["label pinned far away", { image: "shot.png", notes: [note("x", { at: [99999, 99999] })] }],
    ["zero size", { image: "shot.png", size: 0, notes: [] }],
    ["half a comparison", { before: "shot.png" }],
    ["unsupported image", { image: "spec.json", notes: [] }],
    ["output over the input", { image: "shot.png", out: "shot.png", notes: [] }],
    ["target outside a capture", { image: "shot.png", notes: [{ text: "x", target: "#a" }] }],
  ];
  for (const [name, spec] of cases)
    test(name, async () => {
      const r = await run(spec);
      expect(r.code).toBe(1);
      expect(r.err).toStartWith("annotate: ");
      expect(r.err.split("\n")).toHaveLength(1);
    });

  test("grid flags", async () => {
    for (const args of [["--step", "0"], ["--step", "-5"], ["--region", "5000,5000,10,10"], ["--region", "1,1,0,0"]]) {
      const r = await run(undefined, "grid", "shot.png", ...args);
      expect(r.code).toBe(1);
      expect(r.err).toStartWith("annotate: ");
    }
  });
});

describe("image files", () => {
  const fx = (f: string) => join(import.meta.dir, "fixtures", f);
  const canConvert = ["sips", "magick", "convert", "dwebp"].some((t) => Bun.which(t));

  test.skipIf(!canConvert)("WebP is converted, not rendered blank", async () => {
    const r = await run({ image: fx("ui.webp"), out: join(dir, "webp.png"), notes: [] });
    expect(r.code).toBe(0);
    const px = pixels(await loadImage(r.json.out));
    expect(px[(10 * 300 + 10) * 4]).toBeGreaterThan(180);
  });

  test("EXIF rotation is applied", async () => {
    const img = await loadImage(fx("rotated.jpg"));
    expect([img.width, img.height]).toEqual([300, 200]);
    const px = pixels(img);
    expect(px[(10 * 300 + 10) * 4]).toBeGreaterThan(180);
  });

  test("truncated files fail loudly", async () => {
    const r = await run({ image: fx("truncated.png"), notes: [] });
    expect(r.code).toBe(1);
    expect(r.err).toContain("truncated");
  });

  test("huge screenshots are fine when notes do not grow them much", async () => {
    await Bun.write(join(dir, "wide.png"), new Resvg(ui(20000, 300)).render().asPng());
    const r = await run({ image: "wide.png", out: "wide-out.png", notes: [{ text: "x", to: [10000, 100, 200, 30] }] });
    expect(r.code).toBe(0);
  });
});

describe("paths", () => {
  test("refuses to overwrite an input through a symlink", async () => {
    symlinkSync(join(dir, "shot.png"), join(dir, "link.png"));
    const r = await run({ image: "link.png", out: "shot.png", notes: [] });
    expect(r.code).toBe(1);
    expect(r.err).toContain("overwrite");
  });

  test("--out is relative to the working directory", async () => {
    mkdirSync(join(dir, "elsewhere"));
    const file = join(dir, "where.json");
    await Bun.write(file, JSON.stringify({ image: "shot.png", notes: [] }));
    const p = Bun.spawn(["bun", CLI, file, "--out", "here.png"], { cwd: join(dir, "elsewhere"), stdout: "ignore", stderr: "ignore" });
    expect(await p.exited).toBe(0);
    expect(await Bun.file(join(dir, "elsewhere", "here.png")).exists()).toBe(true);
  });

  test("too many notes fails fast", async () => {
    const notes = Array.from({ length: 5000 }, (_, i) => ({ text: `n${i}`, to: [i % 1400, i % 900] }));
    const r = await run({ image: "shot.png", notes });
    expect(r.code).toBe(1);
    expect(r.err).toContain("too many");
  });
});

describe("marks", () => {
  test("arrows touch the ring around wide and tall targets", async () => {
    const notes = [
      { text: "wide", to: [280, 420, 840, 30], mark: "circle" },
      { text: "tall", to: [1180, 100, 40, 600], mark: "circle" },
    ];
    const r = await run({ image: "shot.png", out: "rings.png", notes });
    for (const n of r.json.resolved.notes) {
      const [x, y, w, h] = n.to;
      const [tx, ty] = n.tip;
      const slack = r.json.fontSize * 1.6;
      expect(tx).toBeGreaterThan(x - slack);
      expect(tx).toBeLessThan(x + w + slack);
      expect(ty).toBeGreaterThan(y - slack);
      expect(ty).toBeLessThan(y + h + slack);
    }
  });
});

describe.skipIf(!findBrowser(true))("capture", () => {
  const page = (body: string) => `data:text/html,${encodeURIComponent(`<body style="margin:0;font:16px sans-serif">${body}</body>`)}`;

  test("points at a selector", async () => {
    const r = await run({ url: page(`<p id=a style="margin:200px">hello</p>`), out: "cap.png", notes: [{ text: "this one", target: "#a" }] });
    expect(r.code).toBe(0);
    const [x, y, w, h] = r.json.resolved.notes[0].to;
    expect(w).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(300);
    expect(x + h).toBeGreaterThan(0);
  }, 30000);

  test("includes a target below the fold in the shot", async () => {
    const r = await run({ url: page(`<div style="height:3000px"></div><p id=a>far</p>`), out: "far.png", notes: [{ text: "x", target: "#a" }] });
    expect(r.code).toBe(0);
    const [, y, , h] = r.json.resolved.notes[0].to;
    expect(y).toBeGreaterThan(0);
    expect(y + h).toBeLessThan(r.json.height);
  }, 30000);

  test("scrolls targets inside scroll containers into view", async () => {
    const r = await run({
      url: page(`<div style="height:200px;overflow:auto;margin:50px"><div style="height:1000px"></div><p id=a>inside</p></div>`),
      out: "scroller.png",
      notes: [{ text: "x", target: "#a" }],
    });
    expect(r.code).toBe(0);
  }, 30000);

  test("crops around a target on a very long page", async () => {
    const r = await run({ url: page(`<div style="height:50000px"></div><p id=a>bottom</p>`), out: "long.png", notes: [{ text: "x", target: "#a" }] });
    expect(r.code).toBe(0);
    expect(r.json.height).toBeLessThan(4000);
  }, 30000);

  test("one-line errors for page scripts and clips", async () => {
    for (const extra of [{ script: "throw new Error('mine')" }, { clip: [9000, 9000, 10, 10] }, { wait: 300, storageState: "missing.json" }]) {
      const r = await run({ url: page("<p>x</p>"), out: "e.png", notes: [], ...extra });
      expect(r.code).toBe(1);
      expect(r.err.split("\n")).toHaveLength(1);
    }
  }, 60000);

  test("refuses hidden targets", async () => {
    const r = await run({ url: page(`<p id=a style="display:none">x</p>`), out: "h.png", notes: [{ text: "x", target: "#a" }] });
    expect(r.code).toBe(1);
    expect(r.err).toContain("not visible");
  }, 30000);
});
