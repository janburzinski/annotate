---
name: annotate
description: Mark up screenshots with handwritten notes and curved arrows in the Poah font (blue ink, like a designer's callouts), and build before/after comparisons. Use when the user asks to annotate, mark up, call out or explain a screenshot, wants a before and after of a UI change, asks you to "show me" a visual change, or when a marked-up screenshot would explain UI decisions better than prose. Triggers on annotate, annotation, before/after, before and after, callout, mark up, screenshot notes, explain this screenshot, show the change.
---

# Annotate

`annotate` renders short handwritten notes with arrows onto a screenshot. It places labels in
empty space automatically, keeps arrows off text, points at exact element boxes, and composes
before/after pairs. The output is a PNG.

```bash
annotate spec.json                          # render a spec (or `annotate -` to read stdin)
annotate grid shot.png                      # pixel rulers, for reading boxes off any image
annotate grid shot.png --region x,y,w,h     # zoomed rulers for one area
annotate --help
```

If `annotate` is not on PATH, run `bun ~/.agents/skills/annotate/cli/src/index.ts`. Run
`bun install` in `~/.agents/skills/annotate/cli` once if `node_modules` is missing.

## 1. Pick where the coordinates come from

Arrows are only as good as their target boxes. Never guess pixel positions from a glance.

| Source | Use | Accuracy |
| --- | --- | --- |
| Page reachable by URL (`http://localhost:…`, public site, `file://…`, or a bare path to a local `.html` file, resolved against the spec) | capture spec with CSS `target` selectors | exact |
| Page behind a login | `storageState` in the capture spec, or your own browser tool (below) | exact |
| Any other image (user upload, mobile, design file) | `annotate grid`, read boxes off the rulers, then render | ±5px with `--region` |

**Selectors.** Plain text blocks (a `<p>` or `<label>` spanning the row) snap to where their text
actually is. Elements with their own visible box (buttons, inputs, cards, images) keep that box.
Prefer the specific element (`#err`, `label[for=email]`, `text=Forgot password?`,
`button >> nth=1`) over containers. A target below the fold is included automatically (the shot
is cropped around the targets, so a very long page stays a normal image), a target inside a
scroll container is scrolled into view, and a hidden target (no size on the page) is an error.

**Own browser tool.** When you already drive a browser (Playwright, a browse tool), take the
screenshot there and read boxes with `locator.boundingBox()`. Multiply every value by
`devicePixelRatio`, subtract the clip origin if you clipped, and set `"dpr"` in the spec.

**Grid.** `annotate grid shot.png` writes `shot.grid.png` with rulers outside the image. Ruler
numbers are original image pixels; use them directly in `to`. The command also prints the
image's real size and dpr. Use the full grid only to orient yourself, because image viewers
shrink large images and the rulers get hard to read. Then read every target box from a zoomed
`--region x,y,w,h` view. To check a render, run `grid --region` on the output too.

## 2. Write the spec

Coordinates are image pixels. Relative paths in a spec resolve against the spec file's folder;
the `--out` flag resolves against the current directory. PNG and JPEG are read directly (EXIF
rotation applied); WebP, HEIC, GIF, TIFF and CMYK JPEGs are converted with `sips`, ImageMagick or
`dwebp` if one is installed. Truncated files are an error. Up to 150 notes per image.

```jsonc
// Annotate an existing screenshot
{
  "image": "shot.png",
  "out": "shot.annotated.png",
  "notes": [
    { "text": "icon size relative to label", "to": [452, 136, 22, 22] },
    { "text": "keeping the error close to the field", "to": [318, 258, 290, 26], "at": "right" },
    { "text": "optical alignment", "to": [440, 322, 24, 30], "mark": "circle" }
  ]
}
```

```jsonc
// Capture with headless Chromium, then annotate. Targets are Playwright selectors.
{
  "url": "http://localhost:3000/login",
  "out": "login.png",                 // the raw screenshot is saved next to it as login.raw.png
  "clip": "form",                     // optional crop: selector or [x, y, w, h] in CSS px
  "padding": 32,                      // around clip, CSS px (default 24)
  "viewport": { "width": 1280, "height": 800 },
  "dpr": 2,                           // default 2
  "colorScheme": "dark",              // optional
  "wait": "text=Sign in",             // optional selector or milliseconds
  "script": "document.querySelector('#menu').click()",  // optional, runs before the shot
  "storageState": "auth.json",        // optional Playwright login state
  "insecure": true,                   // accept a self-signed certificate (automatic for localhost, *.local, *.test)
  "notes": [{ "text": "full-width primary action", "target": "button[type=submit]" }]
}
```

```jsonc
// Before/after. Each side is an image path, { image, notes }, or a capture spec.
{
  "out": "compare.png",               // captured sides are saved as compare.before.raw.png / compare.after.raw.png
  "before": { "image": "before.png", "notes": [{ "text": "label floats away", "to": [80, 40, 200, 20] }] },
  "after": { "url": "http://localhost:3000/login", "clip": "form", "notes": [{ "text": "tight to its field", "target": "label" }] },
  "labels": ["before", "after"],      // optional
  "layout": "auto"                    // auto | row | column (wide shots stack automatically)
}
```

Note fields:

- `text`: the note. Wraps automatically into balanced lines; `\n` forces a break.
- `to`: `[x, y, w, h]` box (preferred) or `[x, y]` exact point for the arrow tip. Omit it for a free-standing caption, which then needs `at`.
- `at`: omit for automatic placement (best), use `"left" | "right" | "above" | "below"` to restrict the side, or `[x, y]` to pin the label's top-left corner.
- `mark`: hand-drawn emphasis on the target. `"circle"` is a loose ellipse around the box, `"underline"` a stroke under its bottom edge, `"box"` a rough rectangle.
- `bend`: arrow curvature (default `0.12`; negative flips it; `0` is straight).
- `arrow: false`, `wrap` (max line width in font sizes, default 11), `color`.

Spec-wide settings:

- `color`: unset by default, so ink follows what each note is drawn on: deep blue `#1d3fd6` on light, lifted `#7b9bff` on dark, `#4d6df5` when the label and its target sit on opposite ground. Set it to force one colour.
- `dpr`: pixel density of the screenshot. Captures store it inside the PNG, as do macOS retina screenshots, so you rarely need to set it. iPhone screenshots synced to a Mac often claim 2x while really being 3x, so notes can come out a little small; raise `size` if so.
- `size`: font px in image pixels. Without dpr information the size is a guess from the image width. If the notes look small or large, set `size` to about 1.3× the height of the UI's body text, in pixels.
- `frame: true` (or `--frame`): always show the screenshot as a rounded card with a generous light margin. This happens automatically whenever a note lands outside the image, and before/after panels always use it.

## 3. Write notes like a designer

- Lowercase, short (2–8 words), plain words: `keeping the error msg close to the field`.
- Say **why** or **what changed**, not what is already visible. Not "this is a button".
- One note per decision, 1–5 per image. More than that means split it into several images.
- Point at the specific thing (the icon, not the card it sits in).
- Write in the user's language. Poah has no `ß`; it becomes `ss`. Avoid emoji.

## 4. Before/after of your own change

- Capture **before** before you edit: a capture spec with no notes saves the screenshot. Then make
  the change and write a compare spec. Make `before` the saved `.raw.png` with notes, and make
  `after` a capture of the same URL, clip and viewport.
- Already changed? Do not stash or reset the user's work. Run the base branch in a separate git
  worktree on another port and capture it there, or ask the user.
- The panels are never scaled and the two screenshots are aligned automatically, so keep viewport,
  dpr and clip identical and the comparison stays honest.

## 5. Verify (required)

1. Read the CLI output. It prints `warnings` and a `resolved` spec. In `resolved`, each note gets
   its final `at`, its `label` box `[x, y, w, h]` and the arrow `tip` `[x, y]`. These are original-image pixels, so a
   negative value or one past the image size means the label sits in the margin the canvas grew.
   The warnings mean:
   - `covers or touches content` or `collides with another note or arrow`: move that label with `at`. The warning includes its box.
   - `arrow … crosses content`: change `at`, or use a smaller `bend`.
   - `the arrow of note N runs through the label of note M`: move one of the two with `at`.
   - `runs to N lines`: the note is too long. Shorten it; long notes are widened, never cut.
2. Look at the PNG yourself. Check that every arrow lands on its own target, that no label covers
   something important or sits so close to UI text that it reads as part of it, and that the notes
   are legible.
3. To adjust, save `resolved` as a new spec, change `at`, `bend`, `size` or the text, and
   re-render. It points at the saved screenshot, so nothing is captured again. **Write each
   iteration to a new filename** (`--out v2.png`); image viewers cache by path and will show you
   the old file.

## 6. Deliver

Keep working files in a temp folder unless the user wants them in the repo. Show the final PNG
with your harness's image preview if it has one (OpenCode: `browser.preview` with the path). If
there is none, or it fails, give the absolute path. Do not open apps on the user's machine unless
asked.

## Troubleshooting

- `no Chromium found`: run `bunx playwright install chromium-headless-shell`, or set `ANNOTATE_BROWSER` to any Chromium binary.
- `selector not found`: the page differs from what you expected. Inspect it, then fix the selector or `wait`.
- Canvas grew (`extended: true`): some notes sit in the margin, so the screenshot became a rounded card on a light surface (like a designer's callout board). That is intended; pin `at` inside if you need the original size.
- A `to` inside a capture spec is in CSS px relative to the captured area; prefer `target`.
- Errors name the note and the field (`note 2: "to" ... lies outside the 1400x900 image`). The CLI
  refuses targets outside the image, labels pinned far away, zero or negative `size` and `wrap`,
  unknown `mark` or `at` values, colours that are not hex, CSS names, `rgb()` or `hsl()`, and an
  `out` path that would overwrite an input screenshot (symlinks included).
- Capture gives a page 10 s to load and a `wait` selector 10 s to appear, then moves on or fails
  with the reason. Pages that never finish loading (hung images, fonts, streams) still capture.
- Automatic placement chose oddly: run with `ANNOTATE_DEBUG=1` to print the top candidate spots and their scores to stderr.
