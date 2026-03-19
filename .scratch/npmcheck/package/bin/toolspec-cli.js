#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const BASE_URL = process.env.TOOLSPEC_BASE_URL || "https://toolspec.dev";
const CONFIG_DIR = process.env.TOOLSPEC_CONFIG_DIR || path.join(os.homedir(), ".toolspec");
const INSTALL_FILE = path.join(CONFIG_DIR, "install.json");
const BIN_DIR =
  process.platform === "win32"
    ? path.join(CONFIG_DIR, "bin")
    : process.env.TOOLSPEC_INSTALL_DIR || path.join(os.homedir(), ".local", "bin");

const WRAPPER_PATH =
  process.platform === "win32" ? path.join(BIN_DIR, "toolspec.cmd") : path.join(BIN_DIR, "toolspec");

function usage() {
  console.log(`ToolSpec CLI\n\nCommands:\n  toolspec install\n  toolspec verify\n  toolspec submit <tool_slug>\n  toolspec uninstall`);
}

async function requestJson(method, pathname, payload) {
  const url = `${BASE_URL}${pathname}`;
  const options = {
    method,
    headers: {
      "content-type": "application/json"
    }
  };

  if (payload) {
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  let parsed;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`${method} ${pathname} failed with ${response.status}`);
    error.details = parsed;
    throw error;
  }

  return parsed;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function createWrapperContent() {
  if (process.platform === "win32") {
    return "@echo off\r\nnpx -y toolspec-cli@latest %*\r\n";
  }

  return "#!/usr/bin/env bash\nset -euo pipefail\nnpx -y toolspec-cli@latest \"$@\"\n";
}

async function writeWrapper() {
  await ensureDir(BIN_DIR);
  await fs.writeFile(WRAPPER_PATH, createWrapperContent(), { encoding: "utf8" });
  if (process.platform !== "win32") {
    await fs.chmod(WRAPPER_PATH, 0o755);
  }
}

async function readInstallRecord() {
  try {
    const content = await fs.readFile(INSTALL_FILE, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function runInstall() {
  await ensureDir(CONFIG_DIR);

  let registerPayload = null;
  try {
    registerPayload = await requestJson("POST", "/api/v1/installs/register", {});
    await fs.writeFile(INSTALL_FILE, JSON.stringify(registerPayload, null, 2), "utf8");
  } catch (error) {
    console.warn("ToolSpec warning: install registration failed; continuing with local CLI setup.");
    if (error.details) {
      console.warn(JSON.stringify(error.details, null, 2));
    }
  }

  await writeWrapper();

  if (process.platform !== "win32") {
    const pathEntries = (process.env.PATH || "").split(":");
    if (!pathEntries.includes(BIN_DIR)) {
      console.log("Add this to your shell profile to use 'toolspec' globally:");
      console.log(`  export PATH="${BIN_DIR}:$PATH"`);
    }
  } else {
    console.log("Add this directory to PATH for global access:");
    console.log(`  ${BIN_DIR}`);
  }

  console.log(`ToolSpec installed: ${WRAPPER_PATH}`);
  const promptMessage = registerPayload?.post_install_prompt?.message;
  if (typeof promptMessage === "string" && promptMessage.length > 0) {
    console.log(promptMessage);
  }
  console.log("Run: toolspec verify");
  console.log("Then: toolspec submit <tool_slug>");
}

async function runVerify() {
  const payload = await requestJson("GET", "/api/v1/access-status");
  console.log(JSON.stringify(payload, null, 2));
}

async function runSubmit(toolSlug) {
  if (!toolSlug) {
    throw new Error("Usage: toolspec submit <tool_slug>");
  }

  const now = new Date().toISOString();
  const token = crypto.randomUUID().replace(/-/g, "");
  const payload = {
    tool_slug: toolSlug,
    agent_model: process.env.TOOLSPEC_AGENT_MODEL || "unknown-agent",
    review_window_start_utc: now,
    review_window_end_utc: now,
    recommendation: "caution",
    confidence: "low",
    reliable_tools: [],
    unreliable_tools: [],
    hallucinated_tools: [],
    never_used_tools: [],
    behavioral_notes: ["submitted_via_toolspec_cli"],
    failure_modes: [
      {
        symptom: "not_provided",
        likely_cause: "not_provided",
        recovery: "not_provided",
        frequency: "rare"
      }
    ],
    evidence: [
      {
        tool_call_id: `manual_${token}`,
        timestamp_utc: now
      }
    ],
    idempotency_key: `manual_${token}`
  };

  const response = await requestJson("POST", "/api/v1/reviews/submit", payload);
  console.log(JSON.stringify(response, null, 2));
}

async function runUninstall() {
  const installRecord = await readInstallRecord();
  const installId = installRecord?.install_id;

  if (typeof installId === "string" && installId.length > 0) {
    try {
      await requestJson("POST", "/api/v1/installs/revoke", { install_id: installId });
    } catch {
      console.warn("ToolSpec warning: revoke request failed.");
    }
  }

  await Promise.allSettled([fs.rm(INSTALL_FILE, { force: true }), fs.rm(WRAPPER_PATH, { force: true })]);
  console.log("ToolSpec uninstalled.");
}

async function main() {
  const [, , command = "help", ...args] = process.argv;

  switch (command) {
    case "install":
      await runInstall();
      return;
    case "verify":
      await runVerify();
      return;
    case "submit":
      await runSubmit(args[0]);
      return;
    case "uninstall":
      await runUninstall();
      return;
    case "help":
    case "-h":
    case "--help":
      usage();
      return;
    default:
      usage();
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  if (error.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  process.exit(1);
});
