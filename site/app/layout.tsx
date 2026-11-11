import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--geist-mono" });

// Fallback fonts wrap the hero differently, so the first paint waits for the real ones (all preloaded) and
// nothing reflows when they land. Capped at 1.2 s; without JavaScript the page shows right away.
const FONT_GATE = `(function(){var d=document.documentElement,done=0;d.classList.add("wait");
function show(){if(!done){done=1;d.classList.remove("wait")}}setTimeout(show,1200);
document.addEventListener("DOMContentLoaded",function(){requestAnimationFrame(function(){var n={};
document.fonts.forEach(function(f){if(!/Fallback/.test(f.family))n[f.family.replace(/["']/g,"")]=1});
Promise.all(Object.keys(n).map(function(f){return document.fonts.load('16px "'+f+'"',"a")})).then(show,show)})})})()`;

export const metadata: Metadata = {
  title: "annotate: handwritten notes on screenshots",
  description:
    "An agent skill and CLI that turns a short JSON spec into handwritten notes and arrows on a screenshot, set in the Poah font.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        <link rel="preload" href="/poah.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed inline script, see FONT_GATE */}
        <script dangerouslySetInnerHTML={{ __html: FONT_GATE }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
