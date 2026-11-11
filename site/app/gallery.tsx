"use client";

import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export type Example = { src: string; alt: string; caption: string; w: number; h: number; wide?: boolean };

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Transform that puts the large image exactly over its thumbnail (both share one aspect ratio). */
function fromThumb(thumb: Element, big: Element) {
  const a = thumb.getBoundingClientRect();
  const b = big.getBoundingClientRect();
  return `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width})`;
}

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The examples grid. Clicking one grows it from its place into a lightbox; closing shrinks it back. */
export function Gallery({ items }: { items: Example[] }) {
  const [open, setOpen] = useState<number>();
  const [closing, setClosing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const big = useRef<HTMLImageElement>(null);
  const thumbs = useRef<(HTMLImageElement | null)[]>([]);

  useLayoutEffect(() => {
    const thumb = open === undefined ? null : thumbs.current[open];
    if (!thumb || !dialog.current || !big.current) return;
    dialog.current.showModal();
    if (!still()) big.current.animate([{ transform: fromThumb(thumb, big.current) }, { transform: "none" }], { duration: 320, easing: EASE });
  }, [open]);

  const close = () => {
    const thumb = open === undefined ? null : thumbs.current[open];
    if (closing || !thumb || !big.current) return;
    const done = () => {
      dialog.current?.close();
      setOpen(undefined);
      setClosing(false);
    };
    setClosing(true);
    if (still()) return done();
    const anim = big.current.animate([{ transform: "none" }, { transform: fromThumb(thumb, big.current) }], { duration: 220, easing: EASE, fill: "forwards" });
    anim.onfinish = done;
  };

  const item = open === undefined ? undefined : items[open];
  return (
    <>
      <div className="gallery">
        {items.map((e, i) => (
          <figure key={e.src} className={e.wide ? "wide" : undefined} style={{ "--r": e.w / e.h } as CSSProperties}>
            <button type="button" className="zoom" aria-label={`Enlarge: ${e.caption}`} onClick={() => setOpen(i)}>
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
                style={open === i ? { visibility: "hidden" } : undefined}
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
            {/* biome-ignore lint/performance/noImgElement: the same static PNG, at full size */}
            <img ref={big} src={item.src} alt={item.alt} width={item.w} height={item.h} />
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
