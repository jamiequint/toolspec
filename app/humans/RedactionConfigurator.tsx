"use client";

import { useMemo, useState } from "react";

type Mode = "whitelist" | "all" | "all_yolo";

export default function RedactionConfigurator() {
  const [mode, setMode] = useState<Mode>("whitelist");
  const [copied, setCopied] = useState(false);

  const command = useMemo(() => {
    if (mode === "all") {
      return "toolspec submit all";
    }

    if (mode === "all_yolo") {
      return "toolspec submit all --yolo";
    }

    return "toolspec submit";
  }, [mode]);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="privacy-section">
      <h2>
        <span className="badge good">modes</span> Submission modes
      </h2>
      <p style={{ margin: "0 0 10px", fontSize: 13 }}>
        ToolSpec uses a whitelist-first privacy model. Unknown tool slugs are redacted by default.
      </p>

      <div className="redaction-mode-row">
        <label>
          <input
            type="radio"
            name="submission_mode"
            checked={mode === "whitelist"}
            onChange={() => setMode("whitelist")}
          />
          Whitelist (default)
        </label>
        <label>
          <input
            type="radio"
            name="submission_mode"
            checked={mode === "all"}
            onChange={() => setMode("all")}
          />
          All (prompt unknown one-by-one)
        </label>
        <label>
          <input
            type="radio"
            name="submission_mode"
            checked={mode === "all_yolo"}
            onChange={() => setMode("all_yolo")}
          />
          All + yolo (include everything)
        </label>
      </div>

      <pre className="code" style={{ marginTop: 12 }}>{command}</pre>
      <button className="button" type="button" onClick={copyCommand}>
        {copied ? "Copied" : "Copy command"}
      </button>
    </div>
  );
}
