"use client";

import { parse } from "opentype.js";
import { CopyButton } from "./copy";
import { Icon } from "./icons";
import { type PointerEvent, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
// The CLI's own layout engine: the same code places these labels when an agent runs `annotate`.
import { annotate, setFont } from "../../cli/src/render";
import type { Mark, Note, Pixels } from "../../cli/src/types";

type Tool = Mark | "arrow";
type Shot = { src: string; name: string; pixels: Pixels };
/** `hit` is the note whose label the drag started on: a click there opens that note's menu. */
type Drag = { x0: number; y0: number; x1: number; y1: number; hit: number };
/** `index` is set when editing an existing note's text. */
type Pending = { to: number[]; left: number; top: number; index?: number };

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "circle", label: "Circle", key: "1" },
  { id: "box", label: "Box", key: "2" },
  { id: "underline", label: "Underline", key: "3" },
  { id: "arrow", label: "Arrow", key: "4" },
];

const DEMO = { src: "/demo.png", name: "notra-home.png", dpr: 2 };
const DEMO_NOTES: Note[] = [
  { text: "logos stand in for the brand names", to: [789, 320, 112, 112] },
  { text: "one loud action, the other stays quiet", to: [917, 923, 295, 44] },
];
// The "See the Slack app" button: the spot the idle demo invites you to mark.
const TRY = { x: 1316, y: 902, w: 376, h: 90 };
// Big uploads are scaled down first: the engine reads every pixel.
const MAX_SIDE = 3200;
// Widths of the note input and the note menu, to keep them inside the stage.
const INPUT_W = 228;
const MENU_W = 168;

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

export function Bench() {
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
  const [selected, setSelected] = useState<number>();
  const [hover, setHover] = useState(-1);
  const [menu, setMenu] = useState<{ left: number; top: number }>();
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

  /** The topmost note whose label is under an image-pixel point, or -1. */
  const hitNote = (p: { x: number; y: number }) => {
    if (!result || "error" in result) return -1;
    const pad = result.fs * 0.3;
    for (let i = result.resolved.length - 1; i >= 0; i--) {
      const [x, y, w, h] = result.resolved[i].label ?? [];
      if (p.x > x - pad && p.x < x + w + pad && p.y > y - pad && p.y < y + h + pad) return i;
    }
    return -1;
  };

  /** Stage pixels just under a box given in image pixels, kept inside the stage. */
  const under = (box: number[], width: number) => {
    if (!result || "error" in result || !svgRef.current || !stageRef.current) return { left: 8, top: 8 };
    const k = svgRef.current.getBoundingClientRect().width / result.scene.width;
    const stage = stageRef.current.getBoundingClientRect();
    const left = Math.min((box[0] + result.offset[0]) * k, stage.width - width - 8);
    const top = Math.min((box[1] + (box[3] ?? 0) + result.offset[1]) * k + 10, stage.height - 44);
    return { left: Math.max(8, left), top: Math.max(8, top) };
  };

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!shot || pending || e.button !== 0) return;
    const p = toImage(e);
    if (!p) return;
    const hit = hitNote(p);
    const { width: W, height: H } = shot.pixels;
    // Labels can sit in the margin; anywhere else, drawing starts on the screenshot.
    if (hit < 0 && (p.x < 0 || p.y < 0 || p.x > W || p.y > H)) return;
    // With a menu open, a click elsewhere only closes it; on another label it opens that note.
    if (selected !== undefined && hit < 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = Math.min(W, Math.max(0, p.x));
    const y = Math.min(H, Math.max(0, p.y));
    setDrag({ x0: x, y0: y, x1: x, y1: y, hit });
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!shot) return;
    const p = toImage(e);
    if (!p) return;
    if (!drag) {
      const i = pending ? -1 : hitNote(p);
      if (i !== hover) setHover(i);
      return;
    }
    const { width: W, height: H } = shot.pixels;
    setDrag({ ...drag, x1: Math.min(W, Math.max(0, p.x)), y1: Math.min(H, Math.max(0, p.y)) });
  };
  const onUp = () => {
    if (!drag || !result || "error" in result) return;
    const x = Math.round(Math.min(drag.x0, drag.x1));
    const y = Math.round(Math.min(drag.y0, drag.y1));
    const w = Math.round(Math.abs(drag.x1 - drag.x0));
    const h = Math.round(Math.abs(drag.y1 - drag.y0));
    setDrag(undefined);
    const click = w < 10 && h < 10;
    if (click && drag.hit >= 0) {
      setSelected(drag.hit);
      return;
    }
    // A click without a drag points at one spot.
    const to = click ? [x, y] : [x, y, w, h];
    setPending({ to, ...under([x, y, w, h], INPUT_W) });
    setText("");
  };

  // The note menu sits under the selected label, and follows it when the layout changes.
  useLayoutEffect(() => {
    const label = selected === undefined || !result || "error" in result ? undefined : result.resolved[selected]?.label;
    setMenu(label ? under(label, MENU_W) : undefined);
  }, [selected, result]);

  const close = () => {
    setPending(undefined);
    setSelected(undefined);
  };
  // Edits re-lay out every note; only brand-new notes draw themselves in.
  const quietly = (f: (n: Note[]) => Note[]) => {
    drawn.current = Number.POSITIVE_INFINITY;
    setNotes(f);
  };
  const remove = (i: number) => {
    quietly((n) => n.filter((_, k) => k !== i));
    setSelected(undefined);
    setHover(-1);
  };
  const setMark = (i: number, t: Tool) => quietly((n) => n.map((x, k) => (k === i ? { ...x, mark: t === "arrow" ? undefined : t } : x)));
  const edit = (i: number) => {
    const label = result && !("error" in result) ? result.resolved[i]?.label : undefined;
    setSelected(undefined);
    setPending({ to: notes[i].to ?? [], index: i, ...under(label ?? [8, 8, 0, 0], INPUT_W) });
    setText(notes[i].text);
  };

  // Clicking anywhere outside the open note input or menu closes it.
  useEffect(() => {
    if (!pending && selected === undefined) return;
    const onPointer = (e: globalThis.PointerEvent) => {
      if (!(e.target as Element).closest(".note-input, .note-menu")) {
        setPending(undefined);
        setSelected(undefined);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [pending, selected]);

  const commit = () => {
    if (!pending) return;
    const { index } = pending;
    if (index !== undefined) {
      const t = text.trim();
      if (t) quietly((n) => n.map((x, k) => (k === index ? { ...x, text: t } : x)));
      setPending(undefined);
      return;
    }
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
      close();
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
    close();
    setShot(await loadShot(DEMO.src, DEMO.name, DEMO.dpr));
    setNotes(DEMO_NOTES);
  };

  const spec = shot ? specJson(shot, notes) : "";
  const ok = result && !("error" in result);
  const layer = ok ? result.scene.images[0] : undefined;
  const sel = drag && ok ? { x: Math.min(drag.x0, drag.x1) + result.offset[0], y: Math.min(drag.y0, drag.y1) + result.offset[1], w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) } : undefined;

  // Escape closes the note input or menu from anywhere. Otherwise, never while typing: 1-4 pick a
  // tool, Z undoes, R resets, O opens a screenshot, Delete removes the selected note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (pending || selected !== undefined)) {
        close();
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]") || e.altKey || pending) return;
      if (selected !== undefined && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        remove(selected);
        return;
      }
      const tool = TOOLS.find((x) => x.key === e.key);
      if (tool && !e.metaKey && !e.ctrlKey) setTool(tool.id);
      else if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        setSelected(undefined);
        setNotes((n) => n.slice(0, -1));
      } else if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) reset();
      else if (e.key.toLowerCase() === "o" && !e.metaKey && !e.ctrlKey) fileRef.current?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const tools = TOOLS.map((t) => (
    <button
      key={t.id}
      type="button"
      className="icon-btn tool"
      data-label={`${t.label}  ${t.key}`}
      aria-label={t.label}
      aria-pressed={tool === t.id}
      onClick={() => setTool(t.id)}
    >
      <Icon name={t.id} />
    </button>
  ));
  const actions = [
    { id: "undo", label: "Undo", key: "Z", icon: "undo" as const, run: () => {
        setSelected(undefined);
        setNotes((n) => n.slice(0, -1));
      },
      off: !notes.length,
    },
    { id: "reset", label: "Reset", key: "R", icon: "reset" as const, run: reset, off: false },
    { id: "open", label: "Use your screenshot", key: "O", icon: "image" as const, run: () => fileRef.current?.click(), off: false },
  ].map((a) => (
    <button key={a.id} type="button" className="icon-btn tool" data-label={`${a.label}  ${a.key}`} aria-label={a.label} disabled={a.off} onClick={a.run}>
      <Icon name={a.icon} />
    </button>
  ));
  // The dock always says what to do next.
  const next =
    selected !== undefined
      ? "Change the mark, edit or delete"
      : pending
        ? "Type a note, press Enter"
        : drag
          ? "Let go to write a note"
          : "Drag over anything";
  const picked = selected === undefined ? undefined : notes[selected];

  return (
    <div className="bench">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && openShot(e.target.files[0])} />
      <div className="bench-body">
        <div className="stage-wrap">
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
                style={hover >= 0 && !drag ? { cursor: "pointer" } : undefined}
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
                {[...new Set([hover, selected ?? -1])].map((i) => {
                  const label = result.resolved[i]?.label;
                  if (!label) return null;
                  const p = result.fs * 0.25;
                  return (
                    <rect
                      key={i}
                      className={i === selected ? "note-sel" : "note-hover"}
                      x={label[0] + result.offset[0] - p}
                      y={label[1] + result.offset[1] - p}
                      width={label[2] + p * 2}
                      height={label[3] + p * 2}
                      rx={result.fs / 4}
                      strokeWidth={result.fs / 14}
                      strokeDasharray={`${result.fs / 3} ${result.fs / 4}`}
                    />
                  );
                })}
                <g ref={overlayRef} dangerouslySetInnerHTML={{ __html: result.scene.overlay }} />
                {!touched && !drag && !pending && shot.name === DEMO.name && (
                  <g className="ghost" transform={`translate(${TRY.x + layer.x} ${TRY.y + layer.y})`} aria-hidden="true">
                    <rect className="ghost-box" width={TRY.w} height={TRY.h} rx={result.fs / 4} strokeWidth={result.fs / 11} strokeDasharray={`${result.fs / 3} ${result.fs / 4}`} />
                    <g className="ghost-cursor">
                      <path d="M0 0v34l9-9 6 14 6-3-6-13h13z" transform={`scale(${result.fs / 42})`} />
                    </g>
                    <text className="ghost-label" x={TRY.w + result.fs * 0.8} y={TRY.h / 2 + result.fs * 0.35} fontSize={result.fs * 1.15}>
                      try it: drag over this
                    </text>
                  </g>
                )}
                {sel && (
                  <rect x={sel.x} y={sel.y} width={sel.w} height={sel.h} fill="rgb(29 63 214 / 0.08)" stroke="#1d3fd6" strokeWidth={result.fs / 11} strokeDasharray={`${result.fs / 3} ${result.fs / 4}`} rx={result.fs / 5} />
                )}
              </svg>
            ) : (
              <div className="stage-loading">{error ?? (result && "error" in result ? result.error : "loading the engine…")}</div>
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
                  placeholder="your note"
                  aria-label="Note text"
                  onChange={(e) => setText(e.target.value)}
                />
                <button type="submit" aria-label="Place note" title="Place note">
                  <Icon name="enter" />
                </button>
              </form>
            )}
            {picked && menu && selected !== undefined && (
              <div className="note-menu" role="toolbar" aria-label="Note" style={menu}>
                {picked.to?.length === 4 && (
                  <>
                    {TOOLS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="icon-btn tool"
                        data-label={t.id === "arrow" ? "Arrow only" : t.label}
                        aria-label={t.id === "arrow" ? "Arrow only" : t.label}
                        aria-pressed={(picked.mark ?? "arrow") === t.id}
                        onClick={() => setMark(selected, t.id)}
                      >
                        <Icon name={t.id} />
                      </button>
                    ))}
                    <span className="sep" />
                  </>
                )}
                <button type="button" className="icon-btn tool" data-label="Edit text" aria-label="Edit text" onClick={() => edit(selected)}>
                  <Icon name="pencil" />
                </button>
                <button
                  type="button"
                  className="icon-btn tool"
                  data-danger
                  data-label="Delete  ⌫"
                  aria-label="Delete note"
                  onClick={() => remove(selected)}
                >
                  <Icon name="trash" />
                </button>
              </div>
            )}
          </div>
          <div className="dock" role="toolbar" aria-label="Annotate">
            {tools}
            <span className="sep" />
            {actions}
            <span className="sep" />
            <span className="dock-next" aria-live="polite">
              {next}
            </span>
          </div>
        </div>

        <div className="spec">
          <div className="spec-head">
            <span>spec.json</span>
            <CopyButton text={spec} label="Copy spec" />
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
