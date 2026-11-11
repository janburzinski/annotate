"use client";

import { parse } from "opentype.js";
import { type PointerEvent, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
// The CLI's own layout engine: the same code places these labels when an agent runs `annotate`.
import { annotate, setFont } from "../../cli/src/render";
import type { Mark, Note, Pixels } from "../../cli/src/types";

type Tool = Mark | "arrow";
type Shot = { src: string; name: string; pixels: Pixels };
type Drag = { x0: number; y0: number; x1: number; y1: number };
type Pending = { to: number[]; left: number; top: number };

const TOOLS: { id: Tool; label: string }[] = [
  { id: "circle", label: "Circle" },
  { id: "box", label: "Box" },
  { id: "underline", label: "Underline" },
  { id: "arrow", label: "Arrow" },
];

const DEMO = { src: "/demo.png", name: "notra-home.png", dpr: 2 };
const DEMO_NOTES: Note[] = [
  { text: "logos stand in for the brand names", to: [789, 320, 112, 112] },
  { text: "one loud action, the other stays quiet", to: [917, 923, 295, 44] },
  { text: "the real product starts above the fold", to: [258, 1166, 2044, 554] },
];
// Big uploads are scaled down first: the engine reads every pixel.
const MAX_SIDE = 3200;

let fontReady: Promise<void> | undefined;
function loadFont() {
  fontReady ??= fetch("/poah.ttf")
    .then((r) => r.arrayBuffer())
    .then((b) => setFont(parse(b)));
  return fontReady;
}

async function loadShot(src: string, name: string, dpr?: number): Promise<Shot> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * k);
  const height = Math.round(img.naturalHeight * k);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d canvas");
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  let url = src;
  if (k < 1) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r));
    if (blob) url = URL.createObjectURL(blob);
  }
  return { src: url, name, pixels: { width, height, px: new Uint8Array(data.buffer), dpr } };
}

/** The spec an agent would write for what is on screen, one note per line. */
function specJson(shot: Shot, notes: Note[]) {
  const note = (n: Note) => {
    const parts = [`"text": ${JSON.stringify(n.text)}`, `"to": [${n.to?.join(", ")}]`];
    if (n.mark) parts.push(`"mark": "${n.mark}"`);
    return `    { ${parts.join(", ")} }`;
  };
  return `{\n  "image": ${JSON.stringify(shot.name)},\n  "notes": [\n${notes.map(note).join(",\n")}\n  ]\n}`;
}

function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of json.matchAll(/"(?:[^"\\]|\\.)*"(\s*:)?/g)) {
    out.push(json.slice(last, m.index));
    out.push(
      <span key={m.index} className={m[1] ? "k" : "s"}>
        {m[0]}
      </span>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(json.slice(last));
  return out;
}

/** Draw on whatever the engine added since the last render: strokes trace, words fade in. */
function animateIn(els: Element[]) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let delay = 0;
  for (const el of els) {
    if (el instanceof SVGPathElement && el.getAttribute("fill") === "none") {
      const len = el.getTotalLength();
      el.animate(
        [
          { strokeDasharray: `${len}`, strokeDashoffset: `${len}` },
          { strokeDasharray: `${len}`, strokeDashoffset: "0" },
        ],
        { duration: 420, delay, easing: "cubic-bezier(.4,0,.2,1)", fill: "backwards" },
      );
      delay += 300;
    } else if (el instanceof SVGPathElement) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: delay - 60, fill: "backwards" });
      delay += 120;
    } else {
      el.animate(
        [
          { opacity: 0, transform: "translateY(6px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 260, delay, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
      );
      delay += 90;
    }
  }
}

export function Bench({ layout = "stacked" }: { layout?: "stacked" | "split" }) {
  const [shot, setShot] = useState<Shot>();
  const [ready, setReady] = useState(false);
  const [notes, setNotes] = useState<Note[]>(DEMO_NOTES);
  const [tool, setTool] = useState<Tool>("circle");
  const [drag, setDrag] = useState<Drag>();
  const [pending, setPending] = useState<Pending>();
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGGElement>(null);
  const drawn = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const clip = useId();

  useEffect(() => {
    Promise.all([loadFont(), loadShot(DEMO.src, DEMO.name, DEMO.dpr)])
      .then(([, s]) => {
        setShot(s);
        setReady(true);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const result = useMemo(() => {
    if (!shot || !ready) return undefined;
    const t0 = performance.now();
    try {
      const a = annotate(shot.pixels, notes, { dpr: shot.pixels.dpr });
      return { ...a, ms: performance.now() - t0 };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [shot, ready, notes]);

  // Earlier notes keep their element count when one is added, so the new elements are the tail.
  useLayoutEffect(() => {
    const g = overlayRef.current?.firstElementChild;
    if (!g) return;
    const els = [...g.children].filter((el) => el.tagName !== "rect");
    if (els.length > drawn.current) animateIn(els.slice(drawn.current));
    drawn.current = els.length;
  }, [result]);

  const toImage = useCallback(
    (e: PointerEvent) => {
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (!svg || !ctm || !result || "error" in result) return undefined;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      return { x: p.x - result.offset[0], y: p.y - result.offset[1] };
    },
    [result],
  );

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!shot || pending || e.button !== 0) return;
    const p = toImage(e);
    if (!p || p.x < 0 || p.y < 0 || p.x > shot.pixels.width || p.y > shot.pixels.height) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag || !shot) return;
    const p = toImage(e);
    if (!p) return;
    const { width: W, height: H } = shot.pixels;
    setDrag({ ...drag, x1: Math.min(W, Math.max(0, p.x)), y1: Math.min(H, Math.max(0, p.y)) });
  };
  const onUp = () => {
    if (!drag || !result || "error" in result || !svgRef.current || !stageRef.current) return;
    const x = Math.round(Math.min(drag.x0, drag.x1));
    const y = Math.round(Math.min(drag.y0, drag.y1));
    const w = Math.round(Math.abs(drag.x1 - drag.x0));
    const h = Math.round(Math.abs(drag.y1 - drag.y0));
    setDrag(undefined);
    // A click without a drag points at one spot.
    const to = w < 10 && h < 10 ? [x, y] : [x, y, w, h];
    const k = svgRef.current.getBoundingClientRect().width / result.scene.width;
    const stage = stageRef.current.getBoundingClientRect();
    const left = Math.min(Math.max(8, (x + result.offset[0]) * k), stage.width - 340);
    const top = Math.min((y + h + result.offset[1]) * k + 10, stage.height - 52);
    setPending({ to, left: Math.max(8, left), top: Math.max(8, top) });
    setText("");
  };

  const commit = () => {
    if (!pending) return;
    const note: Note = { text: text.trim() || "this one", to: pending.to };
    if (tool !== "arrow" && pending.to.length === 4) note.mark = tool;
    setNotes((n) => [...n, note]);
    setPending(undefined);
    setTouched(true);
  };

  const openShot = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    try {
      const s = await loadShot(URL.createObjectURL(file), file.name || "screenshot.png");
      drawn.current = 0;
      setShot(s);
      setNotes([]);
      setTouched(true);
      setError(undefined);
    } catch {
      setError("could not read that image");
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) openShot(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const reset = async () => {
    drawn.current = 0;
    setPending(undefined);
    setShot(await loadShot(DEMO.src, DEMO.name, DEMO.dpr));
    setNotes(DEMO_NOTES);
  };

  const spec = shot ? specJson(shot, notes) : "";
  const ok = result && !("error" in result);
  const layer = ok ? result.scene.images[0] : undefined;
  const sel = drag && ok ? { x: Math.min(drag.x0, drag.x1) + result.offset[0], y: Math.min(drag.y0, drag.y1) + result.offset[1], w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) } : undefined;

  return (
    <div className="bench" data-layout={layout}>
      <div className="bench-bar">
        <div className="segmented" role="group" aria-label="Mark">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="group">
          <button type="button" className="button" data-variant="ghost" disabled={!notes.length} onClick={() => setNotes((n) => n.slice(0, -1))}>
            Undo
          </button>
          <button type="button" className="button" data-variant="ghost" onClick={reset}>
            Reset
          </button>
          <button type="button" className="button" onClick={() => fileRef.current?.click()}>
            Your screenshot
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && openShot(e.target.files[0])} />
        </div>
      </div>

      <div className="bench-body">
        <div
          ref={stageRef}
          className={`stage${dropping ? " drop-active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            const f = e.dataTransfer.files[0];
            if (f) openShot(f);
          }}
        >
          {ok && shot && layer ? (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${result.scene.width} ${result.scene.height}`}
              role="img"
              aria-label={`Screenshot with ${notes.length} handwritten notes`}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={() => setDrag(undefined)}
            >
              {result.scene.background && <rect width={result.scene.width} height={result.scene.height} fill={result.scene.background} />}
              <defs>
                <clipPath id={clip}>
                  <rect x={layer.x} y={layer.y} width={shot.pixels.width} height={shot.pixels.height} rx={layer.radius} />
                </clipPath>
              </defs>
              <image href={shot.src} x={layer.x} y={layer.y} width={shot.pixels.width} height={shot.pixels.height} clipPath={`url(#${clip})`} />
              <g ref={overlayRef} dangerouslySetInnerHTML={{ __html: result.scene.overlay }} />
              {sel && (
                <rect x={sel.x} y={sel.y} width={sel.w} height={sel.h} fill="rgb(29 63 214 / 0.08)" stroke="#1d3fd6" strokeWidth={result.fs / 11} strokeDasharray={`${result.fs / 3} ${result.fs / 4}`} rx={result.fs / 5} />
              )}
            </svg>
          ) : (
            <div className="stage-loading">{error ?? (result && "error" in result ? result.error : "loading the engine…")}</div>
          )}
          {ok && (
            <div className="stage-hint" style={{ opacity: touched || pending ? 0 : 1 }}>
              Drag over anything to annotate it
            </div>
          )}
          {pending && (
            <form
              className="note-input"
              style={{ left: pending.left, top: pending.top }}
              onSubmit={(e) => {
                e.preventDefault();
                commit();
              }}
            >
              <input
                // biome-ignore lint/a11y/noAutofocus: the input appears because the user just marked something
                autoFocus
                value={text}
                maxLength={80}
                placeholder="what's the point?"
                aria-label="Note text"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setPending(undefined)}
              />
              <button type="submit">Place</button>
            </form>
          )}
        </div>

        <div className="spec">
          <div className="spec-head">
            <span>spec.json · what your agent writes</span>
            <button
              type="button"
              className="button"
              data-variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(spec);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre>{highlight(spec)}</pre>
        </div>
      </div>

      <div className="status">
        <span>$ annotate spec.json</span>
        <span>notes: {notes.length}</span>
        {ok && (
          <span className={result.warnings.length ? "warn" : "ok"} title={result.warnings.join("\n")}>
            warnings: {result.warnings.length ? result.warnings.length : "[]"}
          </span>
        )}
        {ok && <span>layout: {Math.max(1, Math.round(result.ms))} ms</span>}
      </div>
    </div>
  );
}
