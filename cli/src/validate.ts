import type { CaptureNote } from "./types";

const SIDES = ["left", "right", "above", "below"];
export const MAX_NOTES = 150;
const MARKS = ["circle", "underline", "box"];
// Hex, CSS names, rgb()/hsl(). Anything else could break out of the SVG attribute it lands in.
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(rgb|hsl)a?\(\s*[\d.%\s,/-]+\))$/i;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nums = (v: unknown, lengths: number[]) => Array.isArray(v) && lengths.includes(v.length) && v.every(isNum);
const fail = (where: string, msg: string): never => {
  throw new Error(`${where}: ${msg}`);
};

export function checkColor(where: string, v: unknown) {
  if (v !== undefined && (typeof v !== "string" || !COLOR.test(v.trim())))
    fail(where, `"color" must be a hex, CSS name, rgb() or hsl() colour, got ${JSON.stringify(v)}`);
}

export function checkStyle(where: string, s: Record<string, unknown>) {
  checkColor(where, s.color);
  if (s.size !== undefined && !(isNum(s.size) && s.size > 0)) fail(where, `"size" must be a positive number`);
  if (s.dpr !== undefined && !(isNum(s.dpr) && s.dpr >= 0.5 && s.dpr <= 4)) fail(where, `"dpr" must be between 0.5 and 4`);
}

export function checkNotes(where: string, notes: unknown, capture = false): asserts notes is CaptureNote[] | undefined {
  if (notes === undefined) return;
  if (!Array.isArray(notes)) fail(where, `"notes" must be an array`);
  // Placement compares every note with every other; past this it gets slow and unreadable anyway.
  if ((notes as unknown[]).length > MAX_NOTES)
    fail(where, `${(notes as unknown[]).length} notes is too many (max ${MAX_NOTES}); split them over several images`);
  (notes as unknown[]).forEach((n, i) => {
    const at = `${where} note ${i + 1}`;
    if (!n || typeof n !== "object" || Array.isArray(n)) return fail(at, "must be an object");
    const note = n as Record<string, unknown>;
    if (typeof note.text !== "string" || !note.text.trim()) fail(at, `"text" must be a non-empty string`);
    if (note.to !== undefined && !nums(note.to, [2, 4])) fail(at, `"to" must be [x, y] or [x, y, w, h] numbers`);
    if (note.target !== undefined && !(capture && typeof note.target === "string" && note.target.trim()))
      fail(at, capture ? `"target" must be a selector string` : `"target" only works in a capture spec (one with "url")`);
    if (note.at !== undefined && !(nums(note.at, [2]) || SIDES.includes(note.at as string)))
      fail(at, `"at" must be [x, y] or one of ${SIDES.join(", ")}`);
    if (note.mark !== undefined && !MARKS.includes(note.mark as string)) fail(at, `"mark" must be one of ${MARKS.join(", ")}`);
    if (note.bend !== undefined && !isNum(note.bend)) fail(at, `"bend" must be a number`);
    if (note.wrap !== undefined && !(isNum(note.wrap) && note.wrap > 0)) fail(at, `"wrap" must be a positive number`);
    if (note.arrow !== undefined && typeof note.arrow !== "boolean") fail(at, `"arrow" must be true or false`);
    checkColor(at, note.color);
    if (note.to === undefined && note.target === undefined && note.at === undefined)
      fail(at, `needs "to"${capture ? `, "target"` : ""} or "at"`);
  });
}

/** Validates one side of a spec: an image path, an image spec or a capture spec. */
export function checkSide(where: string, s: unknown) {
  if (typeof s === "string") return s.trim() || fail(where, "image path is empty");
  if (!s || typeof s !== "object" || Array.isArray(s)) return fail(where, "must be an image path or an object");
  const o = s as Record<string, unknown>;
  const capture = "url" in o;
  if (capture && (typeof o.url !== "string" || !o.url.trim())) fail(where, `"url" must be a string`);
  if (!capture && (typeof o.image !== "string" || !o.image.trim())) fail(where, `needs "image" or "url"`);
  checkStyle(where, o);
  checkNotes(where, o.notes, capture);
}

export function checkSpec(spec: unknown) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) fail("spec", "must be a JSON object");
  const o = spec as Record<string, unknown>;
  if ("before" in o || "after" in o) {
    if (!("before" in o) || !("after" in o)) fail("spec", `a comparison needs both "before" and "after"`);
    checkStyle("spec", o);
    if (o.labels !== undefined && !(Array.isArray(o.labels) && o.labels.length === 2 && o.labels.every((l) => typeof l === "string")))
      fail("spec", `"labels" must be two strings`);
    if (o.layout !== undefined && !["auto", "row", "column"].includes(o.layout as string))
      fail("spec", `"layout" must be auto, row or column`);
    checkSide("before", o.before);
    checkSide("after", o.after);
    return;
  }
  checkSide("spec", o);
}

export function parseRegion(v: string | undefined, W: number, H: number) {
  if (v === undefined) return undefined;
  const r = v.split(",").map(Number);
  if (r.length !== 4 || !r.every(Number.isFinite)) fail("--region", "must be x,y,w,h");
  const [x, y, w, h] = r;
  if (w <= 0 || h <= 0) fail("--region", "width and height must be positive");
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  if (x1 - x0 < 1 || y1 - y0 < 1) fail("--region", `lies outside the ${W}x${H} image`);
  return [x0, y0, x1 - x0, y1 - y0];
}

export function parseStep(v: string | undefined) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) fail("--step", "must be a positive whole number of pixels");
  return n;
}
