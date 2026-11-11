import { Bench } from "./bench";
import { Copy } from "./copy";

export type Variant = "stacked" | "split" | "paper";
export const VARIANTS: Variant[] = ["stacked", "split", "paper"];

const REPO = "https://github.com/janburzinski/annotate";
const CLONE = `git clone ${REPO} ~/.agents/skills/annotate`;
const INSTALL = `${CLONE}
cd ~/.agents/skills/annotate/cli && bun install
mkdir -p ~/.local/bin && ln -s ~/.agents/skills/annotate/cli/src/index.ts ~/.local/bin/annotate
ln -s ~/.agents/skills/annotate ~/.claude/skills/annotate   # Claude Code`;
const PROMPT = `Install the annotate skill from github.com/janburzinski/annotate, then show me a
before and after of the change you just made to the login page.`;

const STEPS = [
  {
    title: "Point at the element",
    body: "Capture a page and target CSS selectors, or read boxes off annotate grid for any other image.",
    code: `{
  "url": "http://localhost:3000/login",
  "clip": "form",
  "notes": [{
    "text": "error sits under its field",
    "target": "#email-error"
  }]
}`,
  },
  {
    title: "The engine places it",
    body: "It scores every spot around the target for text, edges and arrow crossings, then sets the note in Poah and draws a curved arrow.",
    code: `$ annotate login.json
{
  "out": "login.png",
  "warnings": [],
  "resolved": { "notes": [{ "at": [..], "tip": [..] }] }
}`,
  },
  {
    title: "Check, then ship it",
    body: "Warnings say which label to move. The PNG goes into the pull request, so reviewers see the decision instead of hunting for it.",
    code: `$ gh pr edit --attach login.png
| Before | After |
| --- | --- |
| ![](./before.png) | ![](./login.png) |`,
  },
];

const EXAMPLES = [
  { src: "/examples/example.png", alt: "An invite form before and after, with notes on spacing and button order", caption: "Before and after, aligned so the comparison stays honest", w: 1927, h: 1577 },
  { src: "/examples/notra-themes.png", alt: "Pricing cards in light and dark mode with notes", caption: "Light and dark: the ink follows what it is drawn on", w: 1408, h: 2000 },
  { src: "/examples/notra-pricing.png", alt: "A dense plan comparison table with notes in the margins", caption: "Dense pages: labels go where there is room", w: 2000, h: 1578, wide: true },
];

export function Landing({ variant }: { variant: Variant }) {
  return (
    <div className="page" data-theme={variant === "paper" ? "paper" : undefined}>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="wordmark" href="/">
            annotate
          </a>
          <nav>
            <a href="#how">How it works</a>
            <a href="#examples">Examples</a>
            <a href="#install">Install</a>
            <a href={REPO}>GitHub</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="content hero">
          <div className="eyebrow">Agent skill + CLI · v0.1.0</div>
          <h1>
            Your agent marks up screenshots <span className="hand">like a designer would.</span>
          </h1>
          <p className="lead">
            annotate turns a short JSON spec into handwritten notes and arrows on a screenshot. Labels land in empty space, arrows land on the element,
            and before/after pairs line up. The demo runs the CLI&apos;s real layout engine, so try it.
          </p>
          <div className="install">
            <code>{CLONE}</code>
            <Copy text={CLONE} />
          </div>
          <Bench layout={variant === "split" ? "split" : "stacked"} />
        </section>

        <section className="content section" id="how">
          <div className="section-head">
            <div className="eyebrow">How it works</div>
            <h2>The agent picks the target. The CLI does the layout.</h2>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div className="step" key={s.title}>
                <div className="n">0{i + 1}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <pre>{s.code}</pre>
              </div>
            ))}
          </div>
        </section>

        <section className="content section" id="examples">
          <div className="section-head">
            <div className="eyebrow">Examples</div>
            <h2>Same engine, real screenshots.</h2>
            <p>Every image here was rendered by the CLI from a spec in the repo&apos;s docs/examples.</p>
          </div>
          <div className="gallery">
            {EXAMPLES.map((e) => (
              <figure key={e.src} className={e.wide ? "wide" : undefined}>
                {/* biome-ignore lint/performance/noImgElement: static PNGs, shown at their own size */}
                <img src={e.src} alt={e.alt} width={e.w} height={e.h} loading="lazy" />
                <figcaption>{e.caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="content section" id="install">
          <div className="section-head">
            <div className="eyebrow">Install</div>
            <h2>Give it to your agent.</h2>
            <p>Needs Bun 1.2 or newer. Page capture uses any Chromium on the machine. Or ask your agent to do it:</p>
          </div>
          <pre className="prompt">{PROMPT}</pre>
          <div className="steps" style={{ marginTop: "var(--space-5)", gridTemplateColumns: "minmax(0, 1fr)" }}>
            <div className="step">
              <div className="n">by hand</div>
              <pre>{INSTALL}</pre>
            </div>
          </div>
        </section>
      </main>

      <footer className="content footer">
        <p>
          Notes are set in <a href="https://poah.laks.sh/">Poah</a>, a handwriting font by <a href="https://x.com/blakssh">Lakshay Bhushan</a>, under the
          SIL Open Font License 1.1. The style is his, too.
        </p>
        <p>
          Code under the MIT license. <a href={REPO}>github.com/janburzinski/annotate</a>
        </p>
      </footer>
    </div>
  );
}
