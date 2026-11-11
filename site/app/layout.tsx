import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { preload } from "react-dom";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--geist-mono" });

// Fallback fonts wrap the hero differently, and the demo screenshot is the first thing anyone looks at, so
// the first paint waits for the real fonts and the screenshot for the system theme (all preloaded): the page
// appears complete, with nothing reflowing or loading in. Capped at 1.2 s; without JavaScript it shows at once.
// If the cap is hit first, the screenshot stays a flat colour until it is complete instead of drawing in.
const FONT_GATE = `(function(){var d=document.documentElement,done=0;d.classList.add("wait","shot-wait");
function show(){if(!done){done=1;d.classList.remove("wait")}}setTimeout(show,1200);
document.addEventListener("DOMContentLoaded",function(){requestAnimationFrame(function(){var n={};
document.fonts.forEach(function(f){if(!/Fallback/.test(f.family))n[f.family.replace(/["']/g,"")]=1});
var shot=new Image();shot.src=matchMedia("(prefers-color-scheme: dark)").matches?"/demo-dark.png":"/demo.png";
var got=shot.decode().catch(function(){}).then(function(){d.classList.remove("shot-wait")});
Promise.all(Object.keys(n).map(function(f){return document.fonts.load('16px "'+f+'"',"a")}).concat(got)).then(show,show)})})})()`;

export const metadata: Metadata = {
  title: "annotate: handwritten notes on screenshots",
  description:
    "An agent skill and CLI that turns a short JSON spec into handwritten notes and arrows on a screenshot, set in the Poah font.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  preload("/poah.ttf", { as: "font", type: "font/ttf", crossOrigin: "anonymous" });
  preload("/demo.png", { as: "image", fetchPriority: "high", media: "(prefers-color-scheme: light)" });
  preload("/demo-dark.png", { as: "image", fetchPriority: "high", media: "(prefers-color-scheme: dark)" });
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed inline script, see FONT_GATE */}
        <script dangerouslySetInnerHTML={{ __html: FONT_GATE }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
