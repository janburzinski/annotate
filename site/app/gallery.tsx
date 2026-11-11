"use client";

import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export type Example = { src: string; alt: string; caption: string; w: number; h: number; wide?: boolean };

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
// The shadow is a drop-shadow on the frame around the image: it follows the moving image and fades with
// it, instead of being left behind around the thumbnail.
const SHADOW = ["drop-shadow(0 24px 32px rgb(0 0 0 / 0))", "drop-shadow(0 24px 32px rgb(0 0 0 / 0.45))"];

/** Where the large image must start (or end) to sit exactly on its thumbnail; both share one aspect ratio. */
function onThumb(thumb: HTMLElement, big: HTMLElement) {
  const a = thumb.getBoundingClientRect();
  const b = big.getBoundingClientRect();
  const s = a.width / b.width;
  return {
    transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${s})`,
    // The thumbnail's corner radius, in the large image's own pixels.
    clipPath: `inset(0px round ${10 / s}px)`,
  };
}
const OPEN = { transform: "none", clipPath: "inset(0px round 12px)" };

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The examples grid. Clicking one grows it from its place into a lightbox; closing shrinks it back. */
export function Gallery({ items }: { items: Example[] }) {
  const [open, setOpen] = useState<number>();
  const [closing, setClosing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const big = useRef<HTMLImageElement>(null);
  const frame = useRef<HTMLSpanElement>(null);
  const thumbs = useRef<(HTMLImageElement | null)[]>([]);
  // Opened with the keyboard: keep the focus ring on the thumbnail after closing, as keyboard users expect.
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
        img.animate([onThumb(thumb, img), OPEN], { duration: 340, easing: EASE });
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
      // The dialog hands focus back to the thumbnail; after a click, without the ring.
      if (!keyboard.current && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setOpen(undefined);
      setClosing(false);
    };
    setClosing(true);
    if (still()) return done();
    const anim = big.current.animate([OPEN, onThumb(thumb, big.current)], { duration: 240, easing: EASE, fill: "forwards" });
    frame.current?.animate([{ filter: SHADOW[1] }, { filter: SHADOW[0] }], { duration: 240, easing: EASE, fill: "forwards" });
    anim.onfinish = done;
  };

  const item = open === undefined ? undefined : items[open];
  return (
    <>
      <div className="gallery">
        {items.map((e, i) => (
          <figure key={e.src} className={e.wide ? "wide" : undefined} style={{ "--r": e.w / e.h } as CSSProperties}>
            <button
              type="button"
              className="zoom"
              aria-label={`Enlarge: ${e.caption}`}
              onClick={(ev) => {
                if (open !== undefined) return;
                keyboard.current = ev.detail === 0;
                setOpen(i);
              }}
            >
              {/* biome-ignore lint/performance/noImgElement: static PNGs, shown at their own size */}
              <img
                ref={(el) => {
                  thumbs.current[i] = el;
                }}
                src={e.src}
                alt={e.alt}
                width={e.w}
                height={e.h}
                loading="lazy"
              />
            </button>
            <figcaption>{e.caption}</figcaption>
          </figure>
        ))}
      </div>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it through onCancel, and the close button is focusable */}
      <dialog
        ref={dialog}
        className="lightbox"
        data-closing={closing || undefined}
        aria-label={item?.caption}
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
