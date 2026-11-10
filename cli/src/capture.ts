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
function findBrowser() {
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
  if (found) return found;
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
    await page.goto(spec.url, { waitUntil: "networkidle" });
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
      const p = spec.padding ?? 24;
      clip = { x: Math.max(0, x - p), y: Math.max(0, y - p), width: w + p * 2, height: h + p * 2 };
    }
    const fullPage = spec.fullPage ?? !!clip;
    const origin = clip ?? (fullPage ? { x: 0, y: 0 } : await page.evaluate(() => ({ x: scrollX, y: scrollY })));

    const notes: Note[] = [];
    for (const n of spec.notes ?? []) {
      const { target, ...rest } = n;
      if (!target) {
        notes.push(rest);
        continue;
      }
      const [x, y, w, h] = await docBox(target);
      const box = [x - origin.x, y - origin.y, w, h].map((v) => Math.round(v * dpr));
      notes.push({ ...rest, to: rest.to ? rest.to.map((v) => Math.round(v * dpr)) : box });
    }

    const png = await page.screenshot({ clip, fullPage, animations: "disabled", caret: "hide" });
    await Bun.write(shotPath, withDpr(new Uint8Array(png), dpr));
    return { notes, dpr };
  } finally {
    await browser.close();
  }
}
