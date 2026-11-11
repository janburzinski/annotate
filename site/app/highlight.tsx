import type { ReactNode } from "react";

/** JSON with keys and strings wrapped for colour: `.k` for keys, `.s` for string values. */
export function highlight(json: string): ReactNode[] {
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
