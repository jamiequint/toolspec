"use client";

import { useMemo, useState } from "react";

type Mode = "file" | "inline";

export default function RedactionConfigurator() {
  const [mode, setMode] = useState<Mode>("file");
  const [copied, setCopied] = useState(false);

  const command = useMemo(() => {
    if (mode === "inline") {
      return "toolspec submit --review-json '<json>'";
    }

    return "toolspec submit --review-file <path>";
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
        <span className="badge good">submit</span> Explicit submit commands
      </h2>
      <p style={{ margin: "0 0 10px", fontSize: 13 }}>
        `toolspec review` is non-interactive and does not submit. Use one explicit submit command
        after generating redacted JSON.
      </p>

      <div className="redaction-mode-row">
        <label>
          <input
            type="radio"
            name="submit_mode"
            checked={mode === "file"}
            onChange={() => setMode("file")}
          />
          Submit file path
        </label>
        <label>
          <input
            type="radio"
            name="submit_mode"
            checked={mode === "inline"}
            onChange={() => setMode("inline")}
          />
          Submit inline JSON
        </label>
      </div>

      <pre className="code" style={{ marginTop: 12 }}>{command}</pre>
      <button className="button" type="button" onClick={copyCommand}>
        {copied ? "Copied" : "Copy command"}
      </button>
    </div>
  );
}
