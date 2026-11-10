import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { withDpr } from "./image";
import { writeAtomic } from "./png";
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

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|[^/]+\.(local|localhost|test))$/i;
/** Playwright errors carry a multi-line call log; keep the first line. */
const first = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].replace(/^\w+: /, "");
// Tall full-page shots blow past what Chromium can capture in one go.
const MAX_SHOT = 20000;

export async function capture(spec: CaptureSpec, shotPath: string) {
  const { chromium } = await import("playwright-core");
  const dpr = spec.dpr ?? 2;
  const viewport = spec.viewport ?? { width: 1280, height: 800 };
  if (spec.storageState && !existsSync(spec.storageState)) throw new Error(`storageState file not found: ${spec.storageState}`);
  let host = "";
  try {
    host = new URL(spec.url).hostname;
  } catch {
    throw new Error(`not a valid URL: ${spec.url}`);
  }
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: dpr,
      colorScheme: spec.colorScheme,
      storageState: spec.storageState,
      // Local dev servers often use self-signed certificates; public sites must have valid ones.
      ignoreHTTPSErrors: spec.insecure ?? LOCAL.test(host),
    });
    const page = await context.newPage();
    // "commit" returns as soon as the page answers; a hung image, font or stream must not cost 30s.
    const res = await page.goto(spec.url, { waitUntil: "commit", timeout: 30000 }).catch((e: Error) => {
      const m = first(e);
      const hint = /CERT|SSL/.test(m) ? ' (set "insecure": true for a self-signed certificate)' : "";
      throw new Error(`could not load ${spec.url}: ${m}${hint}`);
    });
    if (res && res.status() >= 400) console.error(`annotate: warning: ${spec.url} answered ${res.status()}`);
    await page.waitForLoadState("load", { timeout: 10000 }).catch(() => {});
    // Pages with analytics or polling never go idle; give them a moment, not 30 seconds.
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    if (typeof spec.wait === "number") await page.waitForTimeout(spec.wait);
    else if (spec.wait)
      await page
        .locator(spec.wait)
        .first()
        .waitFor({ timeout: 10000 })
        .catch(() => {
          throw new Error(`wait: ${spec.wait} did not appear within 10s`);
        });
    if (spec.script)
      await page.evaluate(spec.script).catch((e) => {
        throw new Error(`script failed: ${first(e)}`);
      });
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]));

    const docBox = (selector: string, snap = true) =>
      page
        .locator(selector)
        .first()
        .evaluate(
          (el, snap) => {
            // Bring a target hidden inside a scroll container into view, without moving the page.
            const sx = scrollX;
            const sy = scrollY;
            for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
              const o = getComputedStyle(a);
              if (!/(auto|scroll|hidden)/.test(o.overflow + o.overflowX + o.overflowY)) continue;
              const ar = a.getBoundingClientRect();
              const er = el.getBoundingClientRect();
              if (er.bottom > ar.bottom || er.top < ar.top || er.right > ar.right || er.left < ar.left) {
                el.scrollIntoView({ block: "center", inline: "center" });
                window.scrollTo(sx, sy);
                break;
              }
            }
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

    const pageSize = await page.evaluate(() => ({
      w: Math.max(document.documentElement.scrollWidth, innerWidth),
      h: Math.max(document.documentElement.scrollHeight, innerHeight),
    }));
    type Rect = { x: number; y: number; width: number; height: number };
    const fit = (r: Rect, what: string): Rect => {
      const x = Math.max(0, r.x);
      const y = Math.max(0, r.y);
      const w = Math.min(pageSize.w, r.x + r.width) - x;
      const h = Math.min(pageSize.h, r.y + r.height) - y;
      if (w < 1 || h < 1) throw new Error(`${what} lies outside the ${pageSize.w}x${pageSize.h} page`);
      if (h > MAX_SHOT) throw new Error(`${what} is ${Math.round(h)}px tall, more than one screenshot can hold; clip a smaller part`);
      return { x, y, width: w, height: h };
    };

    let clip: Rect | undefined;
    if (spec.clip) {
      const [x, y, w, h] = typeof spec.clip === "string" ? await docBox(spec.clip, false) : spec.clip;
      if (!(w > 0 && h > 0)) throw new Error(`clip ${JSON.stringify(spec.clip)} has no visible area`);
      const p = spec.padding ?? 24;
      clip = fit({ x: x - p, y: y - p, width: w + p * 2, height: h + p * 2 }, "clip");
    }
    // Measure every target first, so one below the fold can still be in the shot.
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
    const found = boxes.filter((b): b is number[] => !!b);
    const offscreen = found.some(
      (b) => b[1] + b[3] > scroll.y + viewport.height || b[1] < scroll.y || b[0] + b[2] > scroll.x + viewport.width,
    );
    let fullPage = spec.fullPage ?? false;
    if (!clip && spec.fullPage === undefined && offscreen) {
      // Crop around the targets with some context, instead of a full shot of a very long page.
      const top = Math.min(...found.map((b) => b[1]));
      const bottom = Math.max(...found.map((b) => b[1] + b[3]));
      const right = Math.max(viewport.width, ...found.map((b) => b[0] + b[2]));
      const margin = viewport.height * 0.25;
      const y0 = Math.max(0, Math.min(top - margin, bottom + margin - viewport.height));
      clip = fit({ x: 0, y: y0, width: right, height: Math.max(viewport.height, bottom + margin - y0) }, "the area around the targets");
    } else if (fullPage) fit({ x: 0, y: 0, width: pageSize.w, height: pageSize.h }, "the full page");
    if (clip) fullPage = true;
    const origin = clip ?? (fullPage ? { x: 0, y: 0 } : scroll);

    const notes: Note[] = (spec.notes ?? []).map(({ target, ...rest }, i) => {
      const b = boxes[i];
      if (rest.to || !b) return { ...rest, to: rest.to?.map((v) => Math.round(v * dpr)) };
      return { ...rest, to: [b[0] - origin.x, b[1] - origin.y, b[2], b[3]].map((v) => Math.round(v * dpr)) };
    });

    // Playwright waits for web fonts before a screenshot; a font that never loads would stall it,
    // so after a while take the shot straight from Chromium instead.
    const png = await page
      .screenshot({ clip, fullPage, animations: "disabled", caret: "hide", timeout: 5000 })
      .catch(async (e) => {
        if (!/Timeout/i.test(String(e))) throw new Error(`screenshot failed: ${first(e)}`);
        const cdp = await context.newCDPSession(page);
        const area = clip ?? (fullPage ? { x: 0, y: 0, width: pageSize.w, height: pageSize.h } : { ...scroll, ...viewport });
        const shot = await cdp.send("Page.captureScreenshot", {
          format: "png",
          clip: { ...area, scale: dpr },
          captureBeyondViewport: true,
        });
        return Buffer.from(shot.data, "base64");
      });
    await writeAtomic(shotPath, withDpr(new Uint8Array(png), dpr));
    return { notes, dpr };
  } finally {
    await browser.close();
  }
}
