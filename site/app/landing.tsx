import { Bench } from "./bench";
import { Command, CopyPrompt } from "./copy";
import { Icon } from "./icons";

const REPO = "https://github.com/janburzinski/annotate";
const CLONE = `git clone ${REPO} ~/.agents/skills/annotate`;
const PROMPT =
  "Install the annotate skill from github.com/janburzinski/annotate (clone it into ~/.agents/skills/annotate and run bun install in its cli folder). Use it whenever a marked-up screenshot or a before and after would explain a UI change better than text.";

const EXAMPLES = [
  { src: "/examples/example.png", alt: "An invite form before and after, with notes on spacing and button order", caption: "Before and after", w: 1927, h: 1577 },
  { src: "/examples/notra-themes.png", alt: "Pricing cards in light and dark mode with notes", caption: "Light and dark", w: 1408, h: 2000 },
  { src: "/examples/notra-pricing.png", alt: "A dense plan comparison table with notes in the margins", caption: "A dense table", w: 2000, h: 1578, wide: true },
];

export function Landing() {
  return (
    <div className="page">
      <header className="topbar">
        <div className="wrap">
          <a className="wordmark" href="/">
            annotate
          </a>
          <nav>
            <a href="#examples">Examples</a>
            <a href={REPO} aria-label="GitHub" title="GitHub">
              <Icon name="github" />
            </a>
            <CopyPrompt text={PROMPT} />
          </nav>
        </div>
      </header>

      <main>
        <section className="wrap hero">
          <h1>
            <span className="hand">Handwritten notes</span> on your screenshots
          </h1>
          <p className="lead">
            annotate is a skill and CLI for coding agents. They point at an element, it places the note and the arrow. Try it on the screenshot below.
          </p>
          <div className="cta">
            <Command text={CLONE} />
          </div>
          <div className="demo">
            <Bench />
          </div>
        </section>

        <section className="wrap section" id="examples">
          <h2>Rendered by the CLI</h2>
          <p className="section-lead">Each image comes from a spec in the repo&apos;s docs/examples.</p>
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
      </main>

      <footer className="wrap footer">
        <p>
          The handwriting is <a href="https://poah.laks.sh/">Poah</a> by <a href="https://x.com/blakssh">Lakshay Bhushan</a> (SIL Open Font License 1.1), and the
          style is his too.
        </p>
        <p>
          MIT licensed · <a href={REPO}>github.com/janburzinski/annotate</a>
        </p>
      </footer>
    </div>
  );
}
