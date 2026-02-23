"use client";

import { useState } from "react";

const SETUP_TEXT = "Go to https://toolspec.dev and install it";

export default function GetStartedCopy() {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(SETUP_TEXT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <p style={{ margin: "0 0 4px", fontSize: "13px" }}>
        Copy this into Codex, Claude Code, or Cursor:
      </p>
      <pre className="code">{SETUP_TEXT}</pre>
      <button className="button" type="button" onClick={onCopy}>
        {copied ? "Copied" : "Copy to clipboard"}
      </button>
    </>
  );
}
