export type Pt = [number, number];
export type Box = { x: number; y: number; w: number; h: number };
export type Side = "left" | "right" | "above" | "below";

/** An image as the layout engine sees it: size plus decoded, premultiplied RGBA. */
export type Pixels = { width: number; height: number; px?: Uint8Array; dpr?: number };

/** The two font measurements the layout needs, satisfied by an opentype.js font. */
export type FontMetrics = {
  charToGlyphIndex(char: string): number;
  getAdvanceWidth(text: string, fontSize: number): number;
};

/** A screenshot placed on the canvas at whole pixels, never resampled. */
export type Layer = { img: Pixels; x: number; y: number; radius: number };

/**
 * What a render is made of: an optional flat background, screenshots, and vector markup on top.
 * The CLI rasterises it to PNG; a browser can draw the same thing as SVG.
 */
export type Scene = {
  width: number;
  height: number;
  background?: string;
  images: Layer[];
  overlay: string;
};
export type Mark = "circle" | "underline" | "box";

export type Note = {
  text: string;
  /** [x, y] point or [x, y, w, h] box, in image pixels. Omit for a free-standing label. */
  to?: number[];
  /** [x, y] top-left of the label, or a side to auto-place on. Omit to auto-place anywhere. */
  at?: Pt | Side;
  bend?: number;
  mark?: Mark;
  /** Draw the arrow (default true when `to` is set). */
  arrow?: boolean;
  /** Max label width in multiples of the font size before wrapping (default 13). */
  wrap?: number;
  color?: string;
  /** Output only: the label's final [x, y, w, h]. Ignored on input. */
  label?: number[];
  /** Output only: where the arrow tip landed. Ignored on input. */
  tip?: number[];
};

export type Style = { color: string; size?: number; dpr?: number };

export type ImageSpec = { image: string; notes?: Note[] };

export type RenderSpec = ImageSpec &
  Partial<Style> & {
    out?: string;
    frame?: boolean;
  };

export type CompareSpec = Partial<Style> & {
  /** Image path, { image, notes }, or a capture spec { url, notes, ... }. */
  before: ImageSpec | CaptureSpec | string;
  after: ImageSpec | CaptureSpec | string;
  labels?: [string, string];
  layout?: "auto" | "row" | "column";
  out?: string;
};

export type CaptureNote = Omit<Note, "to"> & { target?: string; to?: number[] };

export type CaptureSpec = Partial<Style> & {
  url: string;
  out?: string;
  viewport?: { width: number; height: number };
  dpr?: number;
  fullPage?: boolean;
  /** Selector or [x, y, w, h] in CSS px to crop to. */
  clip?: string | number[];
  /** Padding around `clip` in CSS px (default 24). */
  padding?: number;
  /** Selector to wait for, or milliseconds. */
  wait?: string | number;
  /** Playwright storage state file for logged-in pages. */
  storageState?: string;
  /** Run in the page before capturing (e.g. to open a menu). */
  script?: string;
  colorScheme?: "light" | "dark";
  /** Accept invalid TLS certificates (on by default for localhost, *.local and *.test). */
  insecure?: boolean;
  frame?: boolean;
  notes?: CaptureNote[];
};
