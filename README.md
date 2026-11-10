# annotate

Handwritten notes and arrows on screenshots, in the style of a designer's callouts. It is an
agent skill plus a small CLI: an agent (Claude Code, OpenCode) writes a short JSON spec,
the CLI renders it, and the agent checks the result before showing it to you.

![A before/after of an invite form with handwritten blue notes](docs/example.png)

The notes are set in [Poah](https://poah.laks.sh/), a handwriting font by Lakshay.

## What it does

- **Notes on a screenshot.** Give each note a target box and a sentence. The CLI finds empty space
  for the label, keeps it off text and UI, and draws a curved arrow to the target. If nothing fits
  inside, the screenshot becomes a rounded card with the notes around it.
- **Before/after.** Two screenshots side by side or stacked, labelled "before" and "after". They
  are never scaled, and the screenshots are aligned so the comparison stays honest.
- **Capture from a URL.** Point at elements with CSS selectors and the CLI takes the screenshot in
  headless Chromium, so arrows land exactly. Works with localhost, public sites and `file://`.
- **Any other image.** `annotate grid` draws pixel rulers (with a zoom option) so an agent can
  read target boxes off uploads, phone screenshots or design exports.
- **Marks and ink.** Hand-drawn circle, underline and box marks. The ink is deep blue on light
  areas and a lighter blue on dark ones.
- **Self-check.** The CLI warns when a label covers content or an arrow crosses text, and prints
  the final layout as a spec you can tweak and re-render without capturing again.

## Install

Requires [Bun](https://bun.sh). Capturing URLs needs any Chromium: Playwright's download, Chrome,
Brave, Edge, Helium or Arc are found automatically.

```bash
git clone https://github.com/janburzinski/annotate ~/.agents/skills/annotate
cd ~/.agents/skills/annotate/cli && bun install
ln -s ~/.agents/skills/annotate/cli/src/index.ts ~/.local/bin/annotate

# Claude Code reads skills from ~/.claude/skills
ln -s ~/.agents/skills/annotate ~/.claude/skills/annotate

# Only if no Chromium-based browser is installed
bunx playwright install chromium-headless-shell
```

OpenCode picks the skill up from `~/.agents/skills`.

## Use it

Ask your agent to annotate a screenshot or show you a before and after. The skill
([SKILL.md](SKILL.md)) tells it how to find coordinates, write the notes and check the output.

From the command line:

```bash
annotate spec.json                        # render a spec (or `annotate -` for stdin)
annotate grid shot.png                    # pixel rulers for reading coordinates
annotate grid shot.png --region x,y,w,h   # zoomed rulers for one area
annotate spec.json --out v2.png --frame   # different output path, card margin
```

Annotate an existing screenshot (coordinates are image pixels):

```json
{
  "image": "shot.png",
  "notes": [
    { "text": "icon size relative to label", "to": [452, 136, 22, 22] },
    { "text": "keep the error close to the field", "to": [318, 258, 290, 26], "at": "right" },
    { "text": "optical alignment", "to": [440, 322, 24, 30], "mark": "circle" }
  ]
}
```

Capture a page and point at elements by selector:

```json
{
  "url": "http://localhost:3000/login",
  "clip": "form",
  "notes": [{ "text": "full-width primary action", "target": "button[type=submit]" }]
}
```

Before/after, where each side is an image path, an image spec or a capture spec:

```json
{
  "before": { "image": "before.png", "notes": [{ "text": "label floats away", "to": [80, 40, 200, 20] }] },
  "after": { "url": "http://localhost:3000/login", "clip": "form", "notes": [{ "text": "tight to its field", "target": "label" }] }
}
```

[SKILL.md](SKILL.md) has every option: label placement (`at`), arrow curvature (`bend`), marks,
colours, sizes, logged-in pages and troubleshooting.

## How it works

The spec becomes an SVG: the screenshot, Poah text measured with
[opentype.js](https://github.com/opentypejs/opentype.js), and arrows as cubic curves. It is
rendered to PNG with [resvg](https://github.com/thx/resvg-js), so drawing needs no browser.

Label placement is a small search. For each note the CLI tries positions on every side of the
target and scores them using the screenshot's own pixels: edges (text, borders, icons), filled
areas, overlap with other notes, distance, arrow length and whether the curved arrow crosses
content. The cheapest position wins. Captures store the device pixel ratio in the PNG, and macOS
retina screenshots already carry it, so text is sized the same way across renders.

Set `ANNOTATE_DEBUG=1` to print the best spot found on each side and how much each arrow crosses.

## Layout

```
SKILL.md          instructions for the agent
cli/src/          the CLI (render, compose, capture, image, types)
cli/fonts/        Poah and its licence
docs/             README assets
```

## Licence

Poah is by [Lakshay](https://x.com/blakssh) and licensed under the
[SIL Open Font License 1.1](cli/fonts/OFL.txt).
