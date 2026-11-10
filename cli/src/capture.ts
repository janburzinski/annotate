import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { withDpr } from "./image";
import type { CaptureSpec, Note } from "./types";

const CACHES = [`${homedir()}/Library/Caches/ms-playwright`, `${homedir()}/.cache/ms-playwright`];
const CACHED = [
  "chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell",
  "chromium-*/chrome-*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chromium-*/chrome-*/Chromium.app/Contents/MacOS/Chromium",
  "chromium-*/chrome-linux*/chrome",
];
const INSTALLED = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Helium.app/Contents/MacOS/Helium",
  "/Applications/Arc.app/Contents/MacOS/Arc",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** Any Chromium will do: env override, Playwright's downloads (newest first), then installed browsers. */
export function findBrowser(quiet = false) {
  const env = process.env.ANNOTATE_BROWSER;
  if (env) return env;
  for (const dir of CACHES) {
    if (!existsSync(dir)) continue;
    for (const pattern of CACHED) {
      const hits = [...new Bun.Glob(pattern).scanSync({ cwd: dir, onlyFiles: true })].sort().reverse();
      if (hits.length) return `${dir}/${hits[0]}`;
    }
  }
  const found = INSTALLED.find((p) => existsSync(p));
  if (found || quiet) return found;
  throw new Error("no Chromium found: run `bunx playwright install chromium-headless-shell` or set ANNOTATE_BROWSER");
}

export async function capture(spec: CaptureSpec, shotPath: string) {
  const { chromium } = await import("playwright-core");
  const dpr = spec.dpr ?? 2;
  const viewport = spec.viewport ?? { width: 1280, height: 800 };
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: dpr,
      colorScheme: spec.colorScheme,
      storageState: spec.storageState,
    });
    const page = await context.newPage();
    const res = await page.goto(spec.url, { waitUntil: "load", timeout: 30000 }).catch((e: Error) => {
      throw new Error(`could not load ${spec.url}: ${e.message.split("\n")[0]}`);
    });
    if (res && res.status() >= 400) console.error(`annotate: warning: ${spec.url} answered ${res.status()}`);
    // Pages with analytics or polling never go idle; give them a moment, not 30 seconds.
    await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
    if (typeof spec.wait === "number") await page.waitForTimeout(spec.wait);
    else if (spec.wait) await page.locator(spec.wait).first().waitFor();
    if (spec.script) await page.evaluate(spec.script);
    await page.evaluate(() => document.fonts.ready);

    const docBox = (selector: string, snap = true) =>
      page
        .locator(selector)
        .first()
        .evaluate(
          (el, snap) => {
            let r = el.getBoundingClientRect();
            // A plain block (a <p> spanning the row) should be pointed at where its text is,
            // but anything with its own visible box (button, input, card) keeps that box.
            const cs = getComputedStyle(el);
            const ownBox =
              cs.backgroundColor !== "rgba(0, 0, 0, 0)" ||
              Number.parseFloat(cs.borderTopWidth) > 0 ||
              Number.parseFloat(cs.borderBottomWidth) > 0 ||
              /^(INPUT|BUTTON|IMG|SVG|TEXTAREA|SELECT|VIDEO|CANVAS|IFRAME)$/i.test(el.tagName);
            if (snap && !ownBox) {
              const range = document.createRange();
              range.selectNodeContents(el);
              const c = range.getBoundingClientRect();
              if (c.width > 0 && c.height > 0) r = c;
            }
            return [r.x + scrollX, r.y + scrollY, r.width, r.height];
          },
          snap,
          { timeout: 5000 },
        )
        .catch(() => {
          throw new Error(`selector not found: ${selector}`);
        });

    let clip: { x: number; y: number; width: number; height: number } | undefined;
    if (spec.clip) {
      const [x, y, w, h] = typeof spec.clip === "string" ? await docBox(spec.clip, false) : spec.clip;
      if (!(w > 0 && h > 0)) throw new Error(`clip ${JSON.stringify(spec.clip)} has no visible area`);
      const p = spec.padding ?? 24;
      clip = { x: Math.max(0, x - p), y: Math.max(0, y - p), width: w + p * 2, height: h + p * 2 };
    }
    // Measure every target first: one below the fold switches to a full-page shot, so its arrow
    // still has something to land on.
    const boxes: (number[] | null)[] = [];
    for (const n of spec.notes ?? []) {
      if (!n.target) {
        boxes.push(null);
        continue;
      }
      const b = await docBox(n.target);
      if (!(b[2] > 0 && b[3] > 0)) throw new Error(`target ${n.target} is not visible (it has no size on the page)`);
      boxes.push(b);
    }
    const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    const offscreen = boxes.some(
      (b) => b && (b[1] + b[3] > scroll.y + viewport.height || b[1] < scroll.y || b[0] + b[2] > scroll.x + viewport.width),
    );
    const fullPage = spec.fullPage ?? (!!clip || offscreen);
    const origin = clip ?? (fullPage ? { x: 0, y: 0 } : scroll);

    const notes: Note[] = (spec.notes ?? []).map(({ target, ...rest }, i) => {
      const b = boxes[i];
      if (rest.to || !b) return { ...rest, to: rest.to?.map((v) => Math.round(v * dpr)) };
      return { ...rest, to: [b[0] - origin.x, b[1] - origin.y, b[2], b[3]].map((v) => Math.round(v * dpr)) };
    });

    const png = await page.screenshot({ clip, fullPage, animations: "disabled", caret: "hide" });
    await Bun.write(shotPath, withDpr(new Uint8Array(png), dpr));
    return { notes, dpr };
  } finally {
    await browser.close();
  }
}
