"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export type Example = { src: string; alt: string; title: string; body: string; w: number; h: number; area: string };

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const OPEN_CLIP = "inset(0px round 12px)";
// The shadow is a drop-shadow on the frame around the image: it follows the clipped, moving image and
// fades with it, instead of being cut off by the clip or left behind on the thumbnail.
const SHADOW = ["drop-shadow(0 24px 32px rgb(0 0 0 / 0))", "drop-shadow(0 24px 32px rgb(0 0 0 / 0.45))"];

/**
 * Where the large image must start (or end) to sit exactly on its thumbnail: the same box, cut to the
 * part the tile shows. Both images share one aspect ratio; the clip is in the large image's own pixels.
 */
function onThumb(thumb: HTMLElement, big: HTMLElement) {
  const a = thumb.getBoundingClientRect();
  const b = big.getBoundingClientRect();
  const t = thumb.closest(".tile")?.getBoundingClientRect() ?? a;
  const s = a.width / b.width;
  const top = Math.max(0, t.top - a.top) / s;
  const right = Math.max(0, a.right - t.right) / s;
  const bottom = Math.max(0, a.bottom - t.bottom) / s;
  const left = Math.max(0, t.left - a.left) / s;
  return {
    transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${s})`,
    clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${10 / s}px)`,
  };
}

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The examples as a bento grid. A tile opens its full image in a lightbox that grows out of the tile. */
export function Gallery({ items, children }: { items: Example[]; children?: ReactNode }) {
  const [open, setOpen] = useState<number>();
  const [closing, setClosing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const big = useRef<HTMLImageElement>(null);
  const frame = useRef<HTMLSpanElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const thumbs = useRef<(HTMLImageElement | null)[]>([]);
  // Opened with the keyboard: keep the focus ring on the tile after closing, as keyboard users expect.
  const keyboard = useRef(false);

  // Open only once the large image is decoded, so it never pops in blank or mid-animation. The thumbnail
  // hides in the same frame the dialog opens, and shows again in the same frame it closes.
  useLayoutEffect(() => {
    const thumb = open === undefined ? null : thumbs.current[open];
    const img = big.current;
    if (!thumb || !img) return;
    let live = true;
    img
      .decode()
      .catch(() => {})
      .then(() => {
        if (!live || !dialog.current) return;
        dialog.current.showModal();
        thumb.style.visibility = "hidden";
        if (still()) return;
        img.animate([onThumb(thumb, img), { transform: "none", clipPath: OPEN_CLIP }], { duration: 340, easing: EASE });
        frame.current?.animate([{ filter: SHADOW[0] }, { filter: SHADOW[1] }], { duration: 340, easing: EASE });
      });
    return () => {
      live = false;
    };
  }, [open]);

  const close = () => {
    const thumb = open === undefined ? null : thumbs.current[open];
    if (closing || !thumb || !big.current) return;
    const done = () => {
      thumb.style.visibility = "";
      dialog.current?.close();
      // The dialog hands focus back to the tile; after a click, without the ring.
      if (!keyboard.current && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      // The pointer may rest on the tile it came back to: no hover lift until it moves again.
      const g = grid.current;
      if (g) {
        g.dataset.quiet = "";
        document.addEventListener("pointermove", () => delete g.dataset.quiet, { once: true });
      }
      setOpen(undefined);
      setClosing(false);
    };
    setClosing(true);
    if (still()) return done();
    const anim = big.current.animate([{ transform: "none", clipPath: OPEN_CLIP }, onThumb(thumb, big.current)], {
      duration: 240,
      easing: EASE,
      fill: "forwards",
    });
    frame.current?.animate([{ filter: SHADOW[1] }, { filter: SHADOW[0] }], { duration: 240, easing: EASE, fill: "forwards" });
    anim.onfinish = done;
  };

  const item = open === undefined ? undefined : items[open];
  return (
    <>
      <div className="bento" ref={grid}>
        {items.map((e, i) => (
          <button
            key={e.src}
            type="button"
            className="tile"
            style={{ gridArea: e.area }}
            data-area={e.area}
            aria-label={`${e.title}: open the full image`}
            onClick={(ev) => {
              if (open !== undefined) return;
              keyboard.current = ev.detail === 0;
              setOpen(i);
            }}
          >
            <span className="tile-text">
              <span className="tile-title">{e.title}</span>
              <span className="tile-body">{e.body}</span>
            </span>
            {/* biome-ignore lint/performance/noImgElement: static PNGs, shown at their own size */}
            <img
              ref={(el) => {
                thumbs.current[i] = el;
              }}
              className="tile-img"
              src={e.src}
              alt={e.alt}
              width={e.w}
              height={e.h}
              loading="lazy"
            />
          </button>
        ))}
        {children}
      </div>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it through onCancel, and the close button is focusable */}
      <dialog
        ref={dialog}
        className="lightbox"
        data-closing={closing || undefined}
        aria-label={item?.title}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={close}
      >
        {item && (
          <>
            <span className="lightbox-frame" ref={frame}>
              {/* biome-ignore lint/performance/noImgElement: the same static PNG, at full size */}
              <img ref={big} src={item.src} alt={item.alt} width={item.w} height={item.h} />
            </span>
            <button
              type="button"
              className="lightbox-close"
              aria-label="Close"
              onClick={(e) => {
                e.stopPropagation();
                close();
              }}
            >
              <Icon name="close" />
            </button>
          </>
        )}
      </dialog>
    </>
  );
}
