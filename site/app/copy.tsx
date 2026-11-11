"use client";

import { useState } from "react";
import { Icon } from "./icons";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      <Icon name={done ? "check" : "copy"} />
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
      className="btn btn-sm"
      data-variant="primary"
      title="Copy a prompt that tells your agent to install annotate"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      <Icon name={done ? "check" : "copy"} />
      {done ? "Copied, paste it to your agent" : "Copy prompt"}
    </button>
  );
}
