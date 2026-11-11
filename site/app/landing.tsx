import { Bench, type Chrome } from "./bench";
import { Command, CopyButton } from "./copy";
import { Icon } from "./icons";

export type Variant = "studio" | "window" | "terminal";
export const VARIANTS: Variant[] = ["studio", "window", "terminal"];
const CHROME: Record<Variant, Chrome> = { studio: "dock", window: "window", terminal: "keys" };

const REPO = "https://github.com/janburzinski/annotate";
const CLONE = `git clone ${REPO} ~/.agents/skills/annotate`;
const SETUP = [
  "git clone https://github.com/janburzinski/annotate \\",
  "  ~/.agents/skills/annotate",
  "cd ~/.agents/skills/annotate/cli && bun install",
  "ln -s $PWD/src/index.ts ~/.local/bin/annotate",
];
const MANUAL = `${CLONE}
cd ~/.agents/skills/annotate/cli && bun install
mkdir -p ~/.local/bin && ln -s ~/.agents/skills/annotate/cli/src/index.ts ~/.local/bin/annotate
ln -s ~/.agents/skills/annotate ~/.claude/skills/annotate   # Claude Code`;
const PROMPT = "install the annotate skill from github.com/janburzinski/annotate, then show me a before and after of your last change";

const LEAD =
  "A skill and CLI that turns a short JSON spec into handwritten notes and arrows on a screenshot. Labels find empty space, arrows land on the element. The demo below runs the real layout engine.";

const STEPS = [
  {
    title: "Point at the element",
    body: "Capture a page and target it by CSS selector, or read boxes off annotate grid for any other image.",
    code: `{ "url": "localhost:3000/login",
  "notes": [{
    "text": "error sits under its field",
    "target": "#email-error" }] }`,
  },
  {
    title: "The engine places it",
    body: "Every spot around the target is scored for text, edges and arrow crossings. The note is set in Poah, the arrow curves in.",
    code: `$ annotate login.json
"warnings": [],
"resolved": { "notes": [{ "at", "tip" }] }`,
  },
  {
    title: "Ship it with the PR",
    body: "Warnings say which label to move. The PNG goes into the pull request, so reviewers see the decision.",
    code: `$ gh pr edit --attach login.png
| Before | After |
| ![](before.png) | ![](login.png) |`,
  },
];

const EXAMPLES = [
  { src: "/examples/example.png", alt: "An invite form before and after, with notes on spacing and button order", caption: "Before and after, aligned so the comparison stays honest", w: 1927, h: 1577 },
  { src: "/examples/notra-themes.png", alt: "Pricing cards in light and dark mode with notes", caption: "Light and dark: the ink follows what it is drawn on", w: 1408, h: 2000 },
  { src: "/examples/notra-pricing.png", alt: "A dense plan comparison table with notes in the margins", caption: "Dense pages: labels go where there is room", w: 2000, h: 1578, wide: true },
];

function Badge() {
  return (
    <span className="badge">
      <b>v0.1.0</b> agent skill + CLI · MIT
    </span>
  );
}

function Title() {
  return (
    <h1>
      Your agent marks up screenshots <span className="hand">like a designer.</span>
    </h1>
  );
}

function Hero({ variant }: { variant: Variant }) {
  if (variant === "terminal")
    return (
      <section className="wrap hero">
        <div className="hero-split">
          <div>
            <Badge />
            <Title />
            <p className="lead">{LEAD}</p>
            <div className="cta">
              <a className="btn" data-variant="primary" href="#demo">
                Try the demo
              </a>
              <a className="btn" href={REPO}>
                <Icon name="github" />
                GitHub
              </a>
            </div>
          </div>
          <div className="term">
            <div className="term-bar">
              <i />
              <i />
              <i />
              <span>install</span>
              <CopyButton text={MANUAL} label="Copy install steps" />
            </div>
            <pre>
              {SETUP.map((l, i) => (
                <span key={l}>
                  {l.startsWith(" ") ? "" : <span className="p">$ </span>}
                  {l}
                  {i < SETUP.length - 1 ? "\n" : ""}
                </span>
              ))}
              {"\n\n"}
              <span className="c"># or tell your agent:</span>
              {"\n"}
              <span className="c"># {PROMPT}</span>
            </pre>
          </div>
        </div>
        <div id="demo" style={{ marginTop: "var(--space-8)" }}>
          <Bench chrome="keys" />
        </div>
      </section>
    );

  const center = variant === "window";
  return (
    <section className="wrap hero" data-align={center ? "center" : undefined}>
      <Badge />
      <Title />
      <p className="lead">{LEAD}</p>
      <div className="cta">
        <Command text={CLONE} />
        <a className="btn" href={REPO}>
          <Icon name="github" />
          GitHub
        </a>
      </div>
      <div style={{ marginTop: "var(--space-8)", textAlign: "left" }}>
        <Bench chrome={CHROME[variant]} />
      </div>
    </section>
  );
}

export function Landing({ variant }: { variant: Variant }) {
  return (
    <div className="page">
      <header className="topbar">
        <div className="wrap">
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
        <Hero variant={variant} />

        <section className="wrap section" id="how">
          <div className="section-head">
            <div className="eyebrow">how it works</div>
            <h2>The agent picks the target. The CLI does the layout.</h2>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div className="card" key={s.title}>
                <div className="n">0{i + 1}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <pre>{s.code}</pre>
              </div>
            ))}
          </div>
        </section>

        <section className="wrap section" id="examples">
          <div className="section-head">
            <div className="eyebrow">examples</div>
            <h2>Same engine, real screenshots.</h2>
            <p>Each image was rendered by the CLI from a spec in the repo&apos;s docs/examples.</p>
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

        <section className="wrap section" id="install">
          <div className="section-head">
            <div className="eyebrow">install</div>
            <h2>Give it to your agent.</h2>
            <p>Needs Bun 1.2 or newer. Page capture uses any Chromium on the machine.</p>
          </div>
          <div className="install-grid">
            <div className="card">
              <div className="card-head">
                <span>Ask your agent</span>
                <CopyButton text={PROMPT} label="Copy prompt" />
              </div>
              <p className="prompt-text">{PROMPT}</p>
            </div>
            <div className="card">
              <div className="card-head">
                <span>Or by hand</span>
                <CopyButton text={MANUAL} label="Copy install steps" />
              </div>
              <pre>{MANUAL}</pre>
            </div>
          </div>
        </section>
      </main>

      <footer className="wrap footer">
        <p>
          Notes are set in <a href="https://poah.laks.sh/">Poah</a>, a handwriting font by <a href="https://x.com/blakssh">Lakshay Bhushan</a>, under the SIL Open
          Font License 1.1. The style is his, too.
        </p>
        <p>
          Code under the MIT license · <a href={REPO}>github.com/janburzinski/annotate</a>
        </p>
      </footer>
    </div>
  );
}
