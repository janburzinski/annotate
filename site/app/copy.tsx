"use client";

import { useState } from "react";
import { Icon } from "./icons";

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

export function Command({ text }: { text: string }) {
  return (
    <div className="command">
      <span className="prompt">$</span>
      <code>{text}</code>
      <CopyButton text={text} label="Copy command" />
    </div>
  );
}

export function CopyPrompt({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-prompt"
      data-done={done || undefined}
      title="Copies a prompt that tells your agent to install annotate"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      <span className="swap" aria-hidden="true">
        <Icon name="copy" />
        <Icon name="check" />
      </span>
      {/* Both labels share one grid cell, so the button keeps its width when they swap. */}
      <span className="swap">
        <span>Copy prompt</span>
        <span>Copied</span>
      </span>
      <span className="sr-only" aria-live="polite">
        {done ? "Prompt copied" : ""}
      </span>
    </button>
  );
}
