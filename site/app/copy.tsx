"use client";

import { useEffect, useRef, useState } from "react";
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
  // Measure both labels once the font is in, so the button can ease between their widths. The slot
  // keeps the resting width, so the links beside it stay put while the button shrinks.
  const button = useRef<HTMLButtonElement>(null);
  const copy = useRef<HTMLSpanElement>(null);
  const copied = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<{ slot: number; labels: [number, number] }>();
  useEffect(() => {
    document.fonts.ready.then(() => {
      if (button.current && copy.current && copied.current)
        setSize({ slot: button.current.offsetWidth, labels: [copy.current.offsetWidth, copied.current.offsetWidth] });
    });
  }, []);
  return (
    <span className="copy-slot" style={size && { width: size.slot }}>
      <button
        ref={button}
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
        <span className="swap label" style={size && { width: size.labels[done ? 1 : 0] }}>
          <span ref={copy}>Copy prompt</span>
          <span ref={copied}>Copied</span>
        </span>
        <span className="sr-only" aria-live="polite">
          {done ? "Prompt copied" : ""}
        </span>
      </button>
    </span>
  );
}
