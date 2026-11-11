"use client";

import { parse } from "opentype.js";
import { CopyButton } from "./copy";
import { DEMO_DPR, DEMO_NOTES, DEMOS, type Scheme, TRY, type View } from "./demo";
import { highlight } from "./highlight";
import { Icon } from "./icons";
import { type PointerEvent, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
// The CLI's own layout engine: the same code places these labels when an agent runs `annotate`.
import { annotate, setFont } from "../../cli/src/render";
import type { Mark, Note, Pixels } from "../../cli/src/types";

type Tool = Mark | "arrow";
/** `scheme` marks the demo screenshots, which follow the system theme; uploads have none. */
type Shot = { src: string; name: string; pixels: Pixels; scheme?: Scheme };
/** `hit` is the note whose label the drag started on: a click there opens that note's menu. */
type Drag = { x0: number; y0: number; x1: number; y1: number; hit: number };
/** `index` is set when editing an existing note's text; `at` pins the label where an arrow was drawn from. */
type Pending = { to: number[]; left: number; top: number; index?: number; at?: [number, number] };

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "circle", label: "Circle", key: "1" },
  { id: "box", label: "Box", key: "2" },
  { id: "underline", label: "Underline", key: "3" },
  { id: "arrow", label: "Arrow", key: "4" },
];

// Big uploads are scaled down first: the engine reads every pixel.
const MAX_SIDE = 3200;
// Widths of the note input and the note menu (larger on touch screens), to keep them inside the stage.
const INPUT_W = 244;
const MENU_W = 216;

let fontReady: Promise<void> | undefined;
function loadFont() {
  fontReady ??= fetch("/poah.ttf")
    .then((r) => r.arrayBuffer())
    .then((b) => setFont(parse(b)));
  return fontReady;
}

const DARK = "(prefers-color-scheme: dark)";
/** The system theme; undefined on the server and while hydrating, when the page shows both scenes. */
function useScheme(): Scheme | undefined {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(DARK);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => (window.matchMedia(DARK).matches ? "dark" : "light"),
    () => undefined,
  );
}

const loadDemo = (scheme: Scheme) => loadShot(DEMOS[scheme].src, DEMOS[scheme].name, DEMO_DPR).then((s): Shot => ({ ...s, scheme }));

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
function specJson(name: string, notes: Note[]) {
  const note = (n: Note) => {
    const parts = [`"text": ${JSON.stringify(n.text)}`, `"to": [${n.to?.join(", ")}]`];
    if (Array.isArray(n.at)) parts.push(`"at": [${n.at.join(", ")}]`);
    if (n.mark) parts.push(`"mark": "${n.mark}"`);
    return `    { ${parts.join(", ")} }`;
  };
  return `{\n  "image": ${JSON.stringify(name)},\n  "notes": [\n${notes.map(note).join(",\n")}\n  ]\n}`;
}

/** The arrow tool's live preview: a dashed arrow from where the note will sit to what it points at. */
function preview(d: Drag, v: View) {
  const [ox, oy] = v.offset;
  const s = [d.x0 + ox, d.y0 + oy];
  const e = [d.x1 + ox, d.y1 + oy];
  const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
  if (len < 10) return null;
  const ux = (e[0] - s[0]) / len;
  const uy = (e[1] - s[1]) / len;
  const hl = v.fs * 0.5;
  const hw = v.fs * 0.28;
  const head = `M${e[0] - ux * hl - uy * hw},${e[1] - uy * hl + ux * hw} L${e[0]},${e[1]} L${e[0] - ux * hl + uy * hw},${e[1] - uy * hl - ux * hw}`;
  return (
    <g className="arrow-preview" strokeWidth={v.fs / 11} aria-hidden="true">
      <circle cx={s[0]} cy={s[1]} r={v.fs * 0.18} />
      <path d={`M${s[0]},${s[1]} L${e[0]},${e[1]}`} strokeDasharray={`${v.fs / 3} ${v.fs / 4}`} />
      <path d={head} />
    </g>
  );
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

export function Bench({ initial }: { initial: Record<Scheme, View> }) {
  const scheme = useScheme();
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
  const drawn = useRef(Number.POSITIVE_INFINITY);
  const fileRef = useRef<HTMLInputElement>(null);
  const clip = useId();

  useEffect(() => {
    loadFont()
      .then(() => setReady(true))
      .catch((e) => setError(String(e)));
  }, []);
  // The demo screenshot follows the system theme, also when it changes while the page is open; the notes
  // stay, since both captures share one layout. An uploaded screenshot stays put.
  useEffect(() => {
    if (!scheme || (shot && !shot.scheme) || shot?.scheme === scheme) return;
    let live = true;
    loadDemo(scheme)
      .then((s) => live && setShot(s))
      .catch((e) => setError(String(e)));
    return () => {
      live = false;
    };
  }, [scheme, shot]);

  const result = useMemo((): View | { error: string } | undefined => {
    if (!shot || !ready) return undefined;
    const t0 = performance.now();
    try {
      const a = annotate(shot.pixels, notes, { dpr: shot.pixels.dpr });
      return {
        width: a.scene.width,
        height: a.scene.height,
        background: a.scene.background,
        overlay: a.scene.overlay,
        fs: a.fs,
        offset: [a.offset[0], a.offset[1]],
        radius: a.scene.images[0].radius ?? 0,
        // The demo keeps the server's backdrop colour, so taking over changes nothing on screen.
        image: { src: shot.src, width: shot.pixels.width, height: shot.pixels.height, fill: shot.scheme && initial[shot.scheme].image.fill },
        resolved: a.resolved,
        warnings: a.warnings,
        ms: performance.now() - t0,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [shot, ready, notes, initial]);
  const fallback = initial[scheme ?? "light"];
  // Until the engine runs here, show the scene laid out on the server.
  const view: View | undefined = result ? ("error" in result ? undefined : result) : notes === DEMO_NOTES ? fallback : undefined;

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
      if (!svg || !ctm || !view) return undefined;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      return { x: p.x - view.offset[0], y: p.y - view.offset[1] };
    },
    [view],
  );

  /** The topmost note whose label is under an image-pixel point, or -1. */
  const hitNote = (p: { x: number; y: number }) => {
    if (!view) return -1;
    const pad = view.fs * 0.3;
    for (let i = view.resolved.length - 1; i >= 0; i--) {
      const [x, y, w, h] = view.resolved[i].label ?? [];
      if (p.x > x - pad && p.x < x + w + pad && p.y > y - pad && p.y < y + h + pad) return i;
    }
    return -1;
  };

  /** Stage pixels just under a box given in image pixels, kept inside the stage. */
  const under = (box: number[], width: number) => {
    if (!view || !svgRef.current || !stageRef.current) return { left: 8, top: 8 };
    const k = svgRef.current.getBoundingClientRect().width / view.width;
    const stage = stageRef.current.getBoundingClientRect();
    const left = Math.min((box[0] + view.offset[0]) * k, stage.width - width - 8);
    const top = Math.min((box[1] + (box[3] ?? 0) + view.offset[1]) * k + 10, stage.height - 44);
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
    if (!drag || !view) return;
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
    // The arrow tool draws an arrow: the note goes where the drag started, the arrow ends where it stopped.
    // The engine keeps the label there ("at" is its top-left, so the first line sits on the start point).
    if (tool === "arrow" && !click) {
      const at: [number, number] = [Math.round(drag.x0), Math.round(drag.y0 - view.fs * 0.55)];
      setPending({ to: [Math.round(drag.x1), Math.round(drag.y1)], at, ...under([drag.x0, drag.y0, 0, 0], INPUT_W) });
      setText("");
      return;
    }
    // A click without a drag points at one spot; the engine places the label.
    const to = click ? [x, y] : [x, y, w, h];
    setPending({ to, ...under([x, y, w, h], INPUT_W) });
    setText("");
  };

  // The note menu sits under the selected label, and follows it when the layout changes.
  useLayoutEffect(() => {
    const label = selected === undefined || !view ? undefined : view.resolved[selected]?.label;
    setMenu(label ? under(label, MENU_W) : undefined);
  }, [selected, view]);

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
    const label = view?.resolved[i]?.label;
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
    if (pending.at) note.at = pending.at;
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
    setShot(await loadDemo(scheme ?? "light"));
    setNotes(DEMO_NOTES);
  };

  const spec = specJson(shot?.name ?? DEMOS[scheme ?? "light"].name, notes);
  const sel = drag && view ? { x: Math.min(drag.x0, drag.x1) + view.offset[0], y: Math.min(drag.y0, drag.y1) + view.offset[1], w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) } : undefined;

  // Escape closes the note input or menu from anywhere. Otherwise, never while typing: 1-4 pick a
  // tool, Z undoes, R resets, O opens a screenshot, Delete removes the selected note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (pending || selected !== undefined)) {
        close();
        return;
      }
      const t = e.target as HTMLElement;
      if (!ready || t.closest("input, textarea, [contenteditable]") || e.altKey || pending) return;
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
      off: !ready || !notes.length,
    },
    { id: "reset", label: "Reset", key: "R", icon: "reset" as const, run: reset, off: false },
    { id: "open", label: "Use your screenshot", key: "O", icon: "image" as const, run: () => fileRef.current?.click(), off: false },
  ].map((a) => (
    <button key={a.id} type="button" className="icon-btn tool" data-label={`${a.label}  ${a.key}`} aria-label={a.label} disabled={a.off} onClick={a.run}>
      <Icon name={a.icon} />
    </button>
  ));
  // While something is in progress, the dock says what to do next.
  const next =
    selected !== undefined
      ? "Change the mark, edit or delete"
      : pending
        ? "Type a note, press Enter"
        : drag
          ? tool === "arrow"
            ? "Let go on what it points at"
            : "Let go to write a note"
          : "";
  const picked = selected === undefined ? undefined : notes[selected];

  /** One screenshot with its notes. `live` is the interactive one; before the theme is known, the page
   * renders a scene per theme and CSS shows the right one, so dark-mode visitors never see the light demo. */
  const scene = (v: View, key: string, live: boolean) => (
    <svg
      key={key}
      ref={live ? svgRef : undefined}
      className="scene"
      data-scheme={key === "upload" ? undefined : key}
      viewBox={`0 0 ${v.width} ${v.height}`}
      role="img"
      aria-label={`Screenshot with ${notes.length} handwritten notes`}
      style={live && hover >= 0 && !drag ? { cursor: "pointer" } : undefined}
      onPointerDown={live ? onDown : undefined}
      onPointerMove={live ? onMove : undefined}
      onPointerUp={live ? onUp : undefined}
      onPointerCancel={live ? () => setDrag(undefined) : undefined}
    >
      {v.background && <rect width={v.width} height={v.height} fill={v.background} />}
      <defs>
        <clipPath id={`${clip}${key}`}>
          <rect x={v.offset[0]} y={v.offset[1]} width={v.image.width} height={v.image.height} rx={v.radius} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip}${key})`}>
        {v.image.fill && <rect x={v.offset[0]} y={v.offset[1]} width={v.image.width} height={v.image.height} fill={v.image.fill} />}
        <image
          className="shot"
          href={v.image.src}
          x={v.offset[0]}
          y={v.offset[1]}
          width={v.image.width}
          height={v.image.height}
        />
      </g>
      {live &&
        [...new Set([hover, selected ?? -1])].map((i) => {
          const label = v.resolved[i]?.label;
          if (!label) return null;
          const p = v.fs * 0.25;
          return (
            <rect
              key={i}
              className={i === selected ? "note-sel" : "note-hover"}
              x={label[0] + v.offset[0] - p}
              y={label[1] + v.offset[1] - p}
              width={label[2] + p * 2}
              height={label[3] + p * 2}
              rx={v.fs / 4}
              strokeWidth={v.fs / 14}
              strokeDasharray={`${v.fs / 3} ${v.fs / 4}`}
            />
          );
        })}
      <g ref={live ? overlayRef : undefined} dangerouslySetInnerHTML={{ __html: v.overlay }} />
      {!touched && !drag && !pending && (!shot || shot.scheme) && (
        <g className="ghost" transform={`translate(${TRY.x + v.offset[0]} ${TRY.y + v.offset[1]})`} aria-hidden="true">
          <rect className="ghost-box" width={TRY.w} height={TRY.h} rx={v.fs / 4} strokeWidth={v.fs / 11} strokeDasharray={`${v.fs / 3} ${v.fs / 4}`} />
          <g className="ghost-cursor">
            <path d="M0 0v34l9-9 6 14 6-3-6-13h13z" transform={`scale(${v.fs / 42})`} />
          </g>
          <text className="ghost-label" x={TRY.w + v.fs * 0.8} y={TRY.h / 2 + v.fs * 0.35} fontSize={v.fs * 1.15}>
            try it: drag over this
          </text>
        </g>
      )}
      {live && drag && tool === "arrow" && preview(drag, v)}
      {live && sel && tool !== "arrow" && (
        <rect className="sel" x={sel.x} y={sel.y} width={sel.w} height={sel.h} strokeWidth={v.fs / 11} strokeDasharray={`${v.fs / 3} ${v.fs / 4}`} rx={v.fs / 5} />
      )}
    </svg>
  );

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
            {!scheme && notes === DEMO_NOTES
              ? (["light", "dark"] as const).map((k) => scene(initial[k], k, false))
              : view
                ? scene(view, shot ? (shot.scheme ?? "upload") : (scheme ?? "light"), true)
                : <div className="stage-loading">{error ?? (result && "error" in result ? result.error : "")}</div>}
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
            {next && <span className="sep" />}
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
        {view && (
          <span className={view.warnings.length ? "warn" : "ok"} title={view.warnings.join("\n")}>
            warnings: {view.warnings.length ? view.warnings.length : "[]"}
          </span>
        )}
        {view && <span>layout: {Math.max(1, Math.round(view.ms))} ms</span>}
      </div>
    </div>
  );
}
