"use client";

import { useState } from "react";
import { Icon } from "./icons";
import { type Brand, Logo } from "./logos";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      data-done={done || undefined}
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      <span className="swap">
        <Icon name="copy" />
        <Icon name="check" />
      </span>
    </button>
  );
}

const AGENTS: Brand[] = ["claude", "openai", "gemini"];

/** The main call to action: a prompt to paste into your agent. Only the icon changes when copied. */
export function CopyPrompt({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="pill"
      data-done={done || undefined}
      title="Copies a prompt that tells your agent to install annotate"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      <span className="chips" aria-hidden="true">
        {AGENTS.map((b) => (
          <span key={b} className="chip">
            <Logo brand={b} />
          </span>
        ))}
      </span>
      Copy prompt
      <span className="swap" aria-hidden="true">
        <Icon name="copy" />
        <Icon name="check" />
      </span>
      <span className="sr-only" aria-live="polite">
        {done ? "Prompt copied" : ""}
      </span>
    </button>
  );
}
