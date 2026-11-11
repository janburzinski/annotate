import { Bench } from "./bench";
import { demoScene } from "./demo-scene";
import { CopyPrompt } from "./copy";
import { type Example, Gallery } from "./gallery";
import { highlight } from "./highlight";
import { Icon } from "./icons";

const REPO = "https://github.com/janburzinski/annotate";
const PROMPT =
  "Install the annotate skill from github.com/janburzinski/annotate (clone it into ~/.agents/skills/annotate and run bun install in its cli folder). Use it whenever a marked-up screenshot or a before and after would explain a UI change better than text.";

const EXAMPLES: Example[] = [
  {
    src: "/examples/example.png",
    alt: "An invite form before and after, with notes on spacing and button order",
    title: "Before and after",
    body: "Two captures side by side, each note on the element it is about.",
    w: 1927,
    h: 1577,
    area: "a",
  },
  {
    src: "/examples/notra-themes.png",
    alt: "Pricing cards in light and dark mode with notes",
    title: "Light and dark",
    body: "On dark surfaces the ink turns a lighter blue.",
    w: 2587,
    h: 3671,
    area: "c",
  },
  {
    src: "/examples/notra-pricing.png",
    alt: "A dense plan comparison table with notes in the margins",
    title: "Dense pages",
    body: "When the page is full, labels move out to the margins.",
    w: 2850,
    h: 2250,
    area: "d",
  },
];
// The "after" half of docs/examples/invite.json, which rendered the before and after above.
const SPEC = `"url": "invite-after.html",
"clip": "#card",
"notes": [
  { "text": "label tight to its field",
    "target": "label" },
  { "text": "error sits right under the input",
    "target": "#err" },
  { "text": "primary action last, on the right",
    "target": "#send" }
]`;


export function Landing() {
  return (
    <div className="page">
      <main>
        <section className="wrap hero">
          <h1>
            <span className="hand">Handwritten notes</span> on your screenshots
          </h1>
          <p className="lead">
            annotate is a skill and CLI for coding agents. They point at an element, it places the note and the arrow. Try it on the screenshot below.
          </p>
          <div className="cta">
            <CopyPrompt text={PROMPT} />
            <a className="pill-link" href={REPO} aria-label="GitHub">
              <Icon name="github" />
              <span className="pill-link-label">GitHub</span>
            </a>
          </div>
          <div className="demo">
            <Bench initial={demoScene()} />
          </div>
        </section>

        <section className="wrap section" id="examples">
          <h2>Rendered by the CLI</h2>
          <p className="section-lead">Each image comes from a spec in the repo&apos;s docs/examples.</p>
          <Gallery items={EXAMPLES}>
            <div className="tile tile-spec" style={{ gridArea: "s" }}>
              <span className="tile-text">
                <span className="tile-title tile-file">invite.json</span>
                <span className="tile-body">That before and after is this spec. Each note targets a CSS selector.</span>
              </span>
              <pre>{highlight(SPEC)}</pre>
              <code className="tile-run">
                <span>$</span> annotate invite.json
              </code>
            </div>
          </Gallery>
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
