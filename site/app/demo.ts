import type { Note } from "../../cli/src/types";

export type Scheme = "light" | "dark";
// The same page captured in both colour schemes, at one layout: the demo shows the one matching the
// visitor's system theme, and the notes below point at the same pixels in both.
export const DEMOS: Record<Scheme, { src: string; name: string }> = {
  light: { src: "/demo.png", name: "notra-home.png" },
  dark: { src: "/demo-dark.png", name: "notra-home-dark.png" },
};
export const DEMO_DPR = 2;
export const DEMO_NOTES: Note[] = [
  { text: "logos stand in for the brand names", to: [789, 320, 112, 112] },
  { text: "one loud action, the other stays quiet", to: [917, 923, 295, 44] },
];
// The "See the Slack app" button: the spot the idle demo invites you to mark.
export const TRY = { x: 1316, y: 902, w: 376, h: 90 };

/** A laid-out scene, small enough to render on the server and hand to the client as props. */
export type View = {
  width: number;
  height: number;
  background?: string;
  overlay: string;
  fs: number;
  offset: [number, number];
  radius: number;
  image: { src: string; width: number; height: number; placeholder?: string };
  resolved: Note[];
  warnings: string[];
  ms: number;
};
