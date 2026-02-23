"use client";

import { useState } from "react";

const SETUP_TEXT = "Set up https://toolspec.dev";

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
      <p>Copy and paste this into Codex, Claude Code, or Cursor:</p>
      <pre className="code">{SETUP_TEXT}</pre>
      <button className="button" type="button" onClick={onCopy}>
        {copied ? "Copied" : "Copy setup text"}
      </button>
    </>
  );
}
