#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

const BASE_URL = process.env.TOOLSPEC_BASE_URL || "https://toolspec.dev";
const CONFIG_DIR = process.env.TOOLSPEC_CONFIG_DIR || path.join(os.homedir(), ".toolspec");
const INSTALL_FILE = path.join(CONFIG_DIR, "install.json");
const STATE_FILE = path.join(CONFIG_DIR, "state.json");
const DRAFT_FILE = path.join(CONFIG_DIR, "review-draft.json");
const CLI_STANDALONE_VERSION = "standalone-2026-02-27";
const CLI_SCRIPT_PATH = process.env.TOOLSPEC_CLI_SCRIPT || path.join(CONFIG_DIR, "toolspec-cli.js");

const BIN_DIR =
  process.platform === "win32"
    ? path.join(CONFIG_DIR, "bin")
    : process.env.TOOLSPEC_INSTALL_DIR || path.join(os.homedir(), ".local", "bin");

const WRAPPER_PATH =
  process.platform === "win32" ? path.join(BIN_DIR, "toolspec.cmd") : path.join(BIN_DIR, "toolspec");

const PUBLIC_TOOL_WHITELIST = new Set([
  "anthropic",
  "airtable",
  "asana",
  "aws",
  "azure",
  "bigquery",
  "brave",
  "browserbase",
  "cloudflare",
  "confluence",
  "discord",
  "fetch",
  "figma",
  "filesystem",
  "gcp",
  "github",
  "gitlab",
  "google",
  "hubspot",
  "jira",
  "linear",
  "mongodb",
  "mysql",
  "notion",
  "openai",
  "paypal",
  "postgres",
  "redis",
  "salesforce",
  "serpapi",
  "shopify",
  "slack",
  "snowflake",
  "sqlite",
  "stripe",
  "supabase",
  "tavily",
  "twilio",
  "vercel",
  "zendesk"
]);

function usage() {
  console.log(
    "ToolSpec CLI\n\nCommands:\n  toolspec install\n  toolspec status\n  toolspec verify\n  toolspec review\n  toolspec search <keyword>\n  toolspec submit\n  toolspec submit all\n  toolspec submit all --yolo\n  toolspec uninstall"
  );
}

function parseCsvList(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return [];
  }

  const seen = new Set();
  const values = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    values.push(value);
  }
  return values;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const HISTORY_MAX_BYTES_PER_FILE = parsePositiveInteger(
  process.env.TOOLSPEC_HISTORY_MAX_BYTES_PER_FILE,
  1024 * 1024
);
const HISTORY_MAX_TOTAL_BYTES = parsePositiveInteger(
  process.env.TOOLSPEC_HISTORY_MAX_TOTAL_BYTES,
  16 * 1024 * 1024
);
const HISTORY_MAX_FILES = parsePositiveInteger(process.env.TOOLSPEC_HISTORY_MAX_FILES, 250);
const HISTORY_MAX_DIR_ENTRIES = parsePositiveInteger(
  process.env.TOOLSPEC_HISTORY_MAX_DIR_ENTRIES,
  5000
);
const MCP_TOOL_REGEX = /\bmcp__[a-z0-9_]+__[a-z0-9_]+\b/gi;
const FUNCTION_TOOL_REGEX = /\bfunctions\.[a-z0-9_]+\b/gi;

let observedToolSlugsPromise = null;

function expandHomePath(targetPath) {
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    return targetPath;
  }

  if (targetPath === "~") {
    return os.homedir();
  }

  if (targetPath.startsWith("~/")) {
    return path.join(os.homedir(), targetPath.slice(2));
  }

  return targetPath;
}

function getCursorRoots() {
  const roots = [];

  if (process.platform === "darwin") {
    roots.push(path.join(os.homedir(), "Library", "Application Support", "Cursor"));
  }

  if (process.platform === "linux") {
    roots.push(path.join(os.homedir(), ".config", "Cursor"));
  }

  if (process.platform === "win32") {
    if (typeof process.env.APPDATA === "string" && process.env.APPDATA.length > 0) {
      roots.push(path.join(process.env.APPDATA, "Cursor"));
    }
    roots.push(path.join(os.homedir(), "AppData", "Roaming", "Cursor"));
  }

  return uniq(roots.map((value) => path.resolve(value)));
}

function getHistoryScanTargets() {
  const home = os.homedir();
  const defaults = [
    path.join(home, ".claude", "history.jsonl"),
    path.join(home, ".claude", "projects"),
    path.join(home, ".codex", "history.jsonl"),
    path.join(home, ".codex", "sessions")
  ];

  for (const cursorRoot of getCursorRoots()) {
    defaults.push(path.join(cursorRoot, "logs"));
  }

  const overrides = parseCsvList(process.env.TOOLSPEC_HISTORY_PATHS || "").map(expandHomePath);
  return uniq([...defaults, ...overrides].map((value) => path.resolve(value)));
}

function shouldInspectHistoryFile(filePath) {
  const normalized = String(filePath || "").toLowerCase();
  if (normalized.endsWith(".jsonl") || normalized.endsWith(".log")) {
    return true;
  }

  const base = path.basename(normalized);
  return base === "history" || base === "history.json";
}

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function listHistoryFilesRecursively(rootDir, maxEntries = HISTORY_MAX_DIR_ENTRIES) {
  const queue = [rootDir];
  const files = [];
  let visitedEntries = 0;

  for (let index = 0; index < queue.length && visitedEntries < maxEntries; index += 1) {
    const currentDir = queue[index];
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of entries) {
      if (visitedEntries >= maxEntries) {
        break;
      }
      visitedEntries += 1;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!shouldInspectHistoryFile(fullPath)) {
        continue;
      }

      const stats = await safeStat(fullPath);
      if (!stats || !stats.isFile()) {
        continue;
      }

      files.push({
        path: fullPath,
        size: stats.size,
        mtimeMs: stats.mtimeMs || 0
      });
    }
  }

  return files;
}

async function readFileTailUtf8(filePath, maxBytes) {
  const handle = await fs.open(filePath, "r");
  try {
    const stats = await handle.stat();
    const size = Number.isFinite(stats.size) ? stats.size : 0;
    const length = Math.min(size, maxBytes);
    if (length <= 0) {
      return "";
    }

    const start = size > length ? size - length : 0;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

function canonicalizeToolName(rawName) {
  const normalized = String(rawName || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (
    normalized === "shell_command"
    || normalized === "exec_command"
    || normalized === "functions.exec_command"
    || normalized === "write_stdin"
    || normalized === "functions.write_stdin"
  ) {
    return "bash";
  }

  return normalized;
}

function addObservedTool(toolSet, rawName) {
  const normalized = canonicalizeToolName(rawName);
  if (normalized) {
    toolSet.add(normalized);
  }
}

function extractToolSlugsFromText(text, toolSet) {
  if (typeof text !== "string" || text.length === 0) {
    return;
  }

  for (const match of text.match(MCP_TOOL_REGEX) || []) {
    addObservedTool(toolSet, match);
  }

  for (const match of text.match(FUNCTION_TOOL_REGEX) || []) {
    addObservedTool(toolSet, match);
  }
}

function extractToolSlugsFromJsonRecord(record, toolSet) {
  if (!record || typeof record !== "object") {
    return;
  }

  if (record.type === "tool_use" && typeof record.name === "string") {
    addObservedTool(toolSet, record.name);
  }

  if (record.type === "function_call" && typeof record.name === "string") {
    addObservedTool(toolSet, record.name);
  }

  if (typeof record.content === "string") {
    extractToolSlugsFromText(record.content, toolSet);
  }

  if (typeof record.text === "string") {
    extractToolSlugsFromText(record.text, toolSet);
  }

  if (record.message && typeof record.message === "object") {
    const messageContent = record.message.content;
    if (Array.isArray(messageContent)) {
      for (const item of messageContent) {
        if (!item || typeof item !== "object") {
          continue;
        }

        if (item.type === "tool_use" && typeof item.name === "string") {
          addObservedTool(toolSet, item.name);
        }

        if (typeof item.text === "string") {
          extractToolSlugsFromText(item.text, toolSet);
        }
      }
    } else if (typeof messageContent === "string") {
      extractToolSlugsFromText(messageContent, toolSet);
    }
  }

  if (record.payload && typeof record.payload === "object") {
    const payload = record.payload;

    if (payload.type === "function_call" && typeof payload.name === "string") {
      addObservedTool(toolSet, payload.name);
    }

    if (payload.type === "tool_use" && typeof payload.name === "string") {
      addObservedTool(toolSet, payload.name);
    }

    if (typeof payload.arguments === "string") {
      extractToolSlugsFromText(payload.arguments, toolSet);
    }

    if (typeof payload.output === "string") {
      extractToolSlugsFromText(payload.output, toolSet);
    }

    if (Array.isArray(payload.content)) {
      for (const item of payload.content) {
        if (!item || typeof item !== "object") {
          continue;
        }

        if (item.type === "tool_use" && typeof item.name === "string") {
          addObservedTool(toolSet, item.name);
        }

        if (typeof item.text === "string") {
          extractToolSlugsFromText(item.text, toolSet);
        }
      }
    }
  }
}

function parseHistoryContent(content, toolSet) {
  if (typeof content !== "string" || content.length === 0) {
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith("{") || line.startsWith("[")) {
      try {
        extractToolSlugsFromJsonRecord(JSON.parse(line), toolSet);
        continue;
      } catch {
        // Continue with regex fallback below.
      }
    }

    extractToolSlugsFromText(line, toolSet);
  }
}

async function collectObservedToolSlugsFromHistory() {
  const candidates = [];
  for (const targetPath of getHistoryScanTargets()) {
    const stats = await safeStat(targetPath);
    if (!stats) {
      continue;
    }

    if (stats.isFile()) {
      if (shouldInspectHistoryFile(targetPath)) {
        candidates.push({
          path: targetPath,
          size: stats.size,
          mtimeMs: stats.mtimeMs || 0
        });
      }
      continue;
    }

    if (!stats.isDirectory()) {
      continue;
    }

    candidates.push(...(await listHistoryFilesRecursively(targetPath)));
  }

  const dedupedByPath = new Map();
  for (const candidate of candidates) {
    const previous = dedupedByPath.get(candidate.path);
    if (!previous || candidate.mtimeMs > previous.mtimeMs) {
      dedupedByPath.set(candidate.path, candidate);
    }
  }

  const files = Array.from(dedupedByPath.values())
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, HISTORY_MAX_FILES);

  const observedTools = new Set();
  let remainingBytes = HISTORY_MAX_TOTAL_BYTES;

  for (const file of files) {
    if (remainingBytes <= 0) {
      break;
    }

    const maxBytes = Math.min(HISTORY_MAX_BYTES_PER_FILE, remainingBytes);
    if (maxBytes <= 0) {
      break;
    }

    try {
      const content = await readFileTailUtf8(file.path, maxBytes);
      remainingBytes -= Buffer.byteLength(content, "utf8");
      parseHistoryContent(content, observedTools);
    } catch {
      // Ignore unreadable files and continue best-effort.
    }
  }

  return Array.from(observedTools);
}

async function getObservedToolSlugs() {
  if (!observedToolSlugsPromise) {
    observedToolSlugsPromise = (async () => {
      const observedFromEnv = parseCsvList(process.env.TOOLSPEC_OBSERVED_TOOLS || "")
        .map(canonicalizeToolName)
        .filter(Boolean);
      const observedFromHistory = await collectObservedToolSlugsFromHistory();
      return uniq([...observedFromEnv, ...observedFromHistory]).sort();
    })();
  }

  return observedToolSlugsPromise;
}

function getSlugCandidates(toolSlug) {
  const slug = String(toolSlug || "").trim().toLowerCase();
  if (!slug) {
    return [];
  }

  const candidates = new Set([slug]);
  for (const token of slug.split(/[\/:_\-.@]+/).filter(Boolean)) {
    candidates.add(token);
  }

  const mcpServerMatch = slug.match(/^mcp__([^_]+)__/);
  if (mcpServerMatch?.[1]) {
    candidates.add(mcpServerMatch[1]);
  }

  if (slug.includes("server-")) {
    candidates.add(slug.split("server-").pop());
  }

  return Array.from(candidates);
}

function isWhitelistedToolSlug(toolSlug) {
  return getSlugCandidates(toolSlug).some((candidate) => PUBLIC_TOOL_WHITELIST.has(candidate));
}

function partitionObservedTools(observedTools) {
  const publicTools = [];
  const unknownTools = [];

  for (const slug of observedTools) {
    if (isWhitelistedToolSlug(slug)) {
      publicTools.push(slug);
    } else {
      unknownTools.push(slug);
    }
  }

  return { publicTools, unknownTools };
}

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

async function readJsonFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function readInstallRecord() {
  return readJsonFile(INSTALL_FILE);
}

async function readState() {
  return (await readJsonFile(STATE_FILE)) || {};
}

async function writeState(nextState) {
  await writeJsonFile(STATE_FILE, nextState);
}

async function readDraft() {
  return readJsonFile(DRAFT_FILE);
}

async function writeDraft(draft) {
  await writeJsonFile(DRAFT_FILE, draft);
}

async function requestJson(method, pathname, payload) {
  const url = `${BASE_URL}${pathname}`;
  const options = {
    method,
    headers: {
      "content-type": "application/json"
    }
  };

  const installRecord = await readInstallRecord();
  if (typeof installRecord?.install_id === "string" && installRecord.install_id.length > 0) {
    options.headers["x-toolspec-install-id"] = installRecord.install_id;
  }

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

function escapeForShellDoubleQuoted(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

function escapeForCmdSet(value) {
  return String(value).replace(/"/g, '""');
}

function createWrapperContent() {
  const escapedBaseUrl = escapeForShellDoubleQuoted(BASE_URL);
  const escapedConfigDir = escapeForShellDoubleQuoted(CONFIG_DIR);
  const escapedBinDir = escapeForShellDoubleQuoted(BIN_DIR);
  const escapedCliScriptPath = escapeForShellDoubleQuoted(CLI_SCRIPT_PATH);

  if (process.platform === "win32") {
    const cmdBaseUrl = escapeForCmdSet(BASE_URL);
    const cmdConfigDir = escapeForCmdSet(CONFIG_DIR);
    const cmdBinDir = escapeForCmdSet(BIN_DIR);
    const cmdCliScriptPath = escapeForCmdSet(CLI_SCRIPT_PATH);
    return [
      "@echo off",
      `set "TOOLSPEC_BASE_URL=${cmdBaseUrl}"`,
      `set "TOOLSPEC_CONFIG_DIR=${cmdConfigDir}"`,
      `set "TOOLSPEC_INSTALL_DIR=${cmdBinDir}"`,
      `set "TOOLSPEC_CLI_SCRIPT=${cmdCliScriptPath}"`,
      "node \"%TOOLSPEC_CLI_SCRIPT%\" %*",
      ""
    ].join("\r\n");
  }

  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `export TOOLSPEC_BASE_URL="${escapedBaseUrl}"`,
    `export TOOLSPEC_CONFIG_DIR="${escapedConfigDir}"`,
    `export TOOLSPEC_INSTALL_DIR="${escapedBinDir}"`,
    `export TOOLSPEC_CLI_SCRIPT="${escapedCliScriptPath}"`,
    "exec node \"$TOOLSPEC_CLI_SCRIPT\" \"$@\"",
    ""
  ].join("\n");
}

async function writeWrapper() {
  await ensureDir(BIN_DIR);
  await fs.writeFile(WRAPPER_PATH, createWrapperContent(), { encoding: "utf8" });
  if (process.platform !== "win32") {
    await fs.chmod(WRAPPER_PATH, 0o755);
  }
}

function hasInstallId(installRecord) {
  return typeof installRecord?.install_id === "string" && installRecord.install_id.length > 0;
}

async function registerInstallRecord() {
  const payload = await requestJson("POST", "/api/v1/installs/register", {});
  await writeJsonFile(INSTALL_FILE, payload);
  return payload;
}

async function ensureInstallRecord() {
  const installRecord = await readInstallRecord();
  if (hasInstallId(installRecord)) {
    return installRecord;
  }

  return registerInstallRecord();
}

function parseSubmitArgs(args) {
  let allMode = false;
  let yolo = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "all") {
      allMode = true;
      continue;
    }

    if (arg === "--yolo") {
      yolo = true;
      continue;
    }

    throw new Error(`Unknown option for submit: ${arg}\nUsage: toolspec submit [all] [--yolo]`);
  }

  if (yolo && !allMode) {
    throw new Error("`--yolo` requires `all`.");
  }

  return {
    mode: allMode ? "all" : "whitelist",
    yolo
  };
}

function buildEvidence(now, token, submittedTools) {
  if (!submittedTools.length) {
    return [
      {
        tool_call_id: `manual_${token}`,
        timestamp_utc: now
      }
    ];
  }

  return submittedTools.slice(0, 50).map((slug, index) => ({
    tool_call_id: `session_${token}_${index + 1}_${slug}`,
    timestamp_utc: now
  }));
}

function buildPayload({
  installId,
  now,
  token,
  mode,
  yolo,
  observedTools,
  publicTools,
  unknownTools,
  submittedTools,
  redactedToolSlugs
}) {
  return {
    install_id: installId,
    submission_scope: "all_observed",
    observed_tool_slugs: observedTools,
    redacted_tool_slugs: redactedToolSlugs,
    tool_slug: "__session__",
    agent_model: process.env.TOOLSPEC_AGENT_MODEL || "unknown-agent",
    review_window_start_utc: now,
    review_window_end_utc: now,
    recommendation: "caution",
    confidence: "low",
    reliable_tools: submittedTools,
    unreliable_tools: [],
    hallucinated_tools: [],
    never_used_tools: redactedToolSlugs,
    behavioral_notes: [
      "submitted_via_toolspec_cli",
      "submission_scope=all_observed",
      `submit_mode=${mode}`,
      `submit_yolo=${yolo ? "true" : "false"}`,
      `whitelist_tools=${publicTools.length}`,
      `unknown_tools=${unknownTools.length}`,
      `observed_tools=${observedTools.length}`,
      `redacted_tools=${redactedToolSlugs.length}`
    ],
    failure_modes: [
      {
        symptom: "not_provided",
        likely_cause: "not_provided",
        recovery: "not_provided",
        frequency: "rare"
      }
    ],
    evidence: buildEvidence(now, token, submittedTools),
    idempotency_key: `session_${token}`
  };
}

async function prepareReviewDraft({ mode = "whitelist", yolo = false } = {}) {
  const installRecord = await readInstallRecord();
  const installId = typeof installRecord?.install_id === "string" ? installRecord.install_id : undefined;

  const now = new Date().toISOString();
  const token = crypto.randomUUID().replace(/-/g, "");
  const observedTools = await getObservedToolSlugs();
  const { publicTools, unknownTools } = partitionObservedTools(observedTools);

  let submittedTools = [...publicTools];
  let redactedToolSlugs = [...unknownTools];

  if (mode === "all" && yolo) {
    submittedTools = uniq([...publicTools, ...unknownTools]);
    redactedToolSlugs = [];
  }

  const payload = buildPayload({
    installId,
    now,
    token,
    mode,
    yolo,
    observedTools,
    publicTools,
    unknownTools,
    submittedTools: uniq(submittedTools),
    redactedToolSlugs
  });

  const draft = {
    version: 1,
    created_at_utc: now,
    payload,
    summary: {
      mode,
      yolo,
      observed_count: observedTools.length,
      whitelist_count: publicTools.length,
      unknown_count: unknownTools.length,
      submitted_count: payload.reliable_tools.length,
      redacted_count: redactedToolSlugs.length
    }
  };

  await writeDraft(draft);

  const state = await readState();
  await writeState({
    ...state,
    draft_prepared_at_utc: now,
    approval_required: true
  });

  return draft;
}

async function runPrepare({ silent = false } = {}) {
  const draft = await prepareReviewDraft({ mode: "whitelist", yolo: false });

  if (!silent) {
    console.log("Prepared local review draft (not submitted).");
    console.log(JSON.stringify(draft.summary, null, 2));
    console.log(`Draft saved: ${DRAFT_FILE}`);
    console.log("Next step: toolspec review");
  }

  return draft;
}

async function runInstall() {
  await ensureDir(CONFIG_DIR);
  await fs.rm(INSTALL_FILE, { force: true });
  await fs.access(CLI_SCRIPT_PATH);

  await writeWrapper();

  if (process.platform !== "win32") {
    const pathEntries = (process.env.PATH || "").split(":");
    if (!pathEntries.includes(BIN_DIR)) {
      console.log("Add this to your shell profile to use 'toolspec' globally:");
      console.log(`  export PATH=\"${BIN_DIR}:$PATH\"`);
    }
  } else {
    console.log("Add this directory to PATH for global access:");
    console.log(`  ${BIN_DIR}`);
  }

  console.log(`ToolSpec installed: ${WRAPPER_PATH}`);
  console.log(`CLI runtime: ${CLI_SCRIPT_PATH}`);
  console.log(`CLI version: ${CLI_STANDALONE_VERSION}`);
  console.log("Install completed local setup only (no review submission was sent).");
  console.log("REQUIRED NEXT STEP: toolspec review");
  console.log("`toolspec review` previews data and asks for yes/no confirmation before submit.");
  console.log("Optional: toolspec verify");
}

async function runVerify() {
  if (!hasInstallId(await readInstallRecord())) {
    await ensureInstallRecord();
  }

  const installRecord = await readInstallRecord();
  const installId = installRecord?.install_id;
  const suffix = typeof installId === "string" && installId.length > 0
    ? `?install_id=${encodeURIComponent(installId)}`
    : "";

  const payload = await requestJson("GET", `/api/v1/access-status${suffix}`);
  console.log(JSON.stringify(payload, null, 2));
}

async function promptUnknownToolsOneByOne(unknownTools) {
  const included = [];
  const redacted = [];
  if (!stdin.isTTY || !stdout.isTTY || unknownTools.length === 0) {
    return { included, redacted: [...unknownTools], prompted: false };
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    for (const tool of unknownTools) {
      const answer = await rl.question(`Include non-whitelist tool '${tool}'? [y/N]: `);
      const normalized = answer.trim().toLowerCase();
      if (normalized === "y" || normalized === "yes") {
        included.push(tool);
      } else {
        redacted.push(tool);
      }
    }
  } finally {
    rl.close();
  }

  return { included, redacted, prompted: true };
}

async function promptYesNo(question) {
  if (!stdin.isTTY || !stdout.isTTY) {
    return null;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function runStatus() {
  let statusPayload = null;
  const installRecord = await readInstallRecord();
  const installId = installRecord?.install_id;
  const suffix = typeof installId === "string" && installId.length > 0
    ? `?install_id=${encodeURIComponent(installId)}`
    : "";

  try {
    statusPayload = await requestJson("GET", `/api/v1/access-status${suffix}`);
    console.log("ToolSpec status:");
    console.log(JSON.stringify(statusPayload, null, 2));
    console.log("");
  } catch {
    console.log("ToolSpec status unavailable (network/API error).");
    console.log("");
  }

  const state = await readState();
  const draft = await readDraft();
  const searchUnlocked = !!(
    statusPayload
    && statusPayload.submission_access === "granted"
    && statusPayload.post_install_required === false
  );

  if (state.approved_at_utc && searchUnlocked) {
    console.log(`Approval status: approved at ${state.approved_at_utc}`);
    console.log("Search enabled: toolspec search <keyword>");
  } else if (state.approved_at_utc) {
    console.log(`Approval status: approved at ${state.approved_at_utc}`);
    console.log("Search locked until required contribution is completed.");
    if (typeof statusPayload?.post_install_required_message === "string") {
      console.log(statusPayload.post_install_required_message);
    }
    if (typeof statusPayload?.post_install_required_command === "string") {
      console.log(`REQUIRED NEXT STEP: ${statusPayload.post_install_required_command}`);
    } else {
      console.log("REQUIRED NEXT STEP: toolspec review");
    }
  } else if (draft?.summary) {
    console.log("Approval status: pending");
    console.log(
      `Draft summary: observed=${draft.summary.observed_count}, whitelist=${draft.summary.whitelist_count}, unknown=${draft.summary.unknown_count}, redacted=${draft.summary.redacted_count}`
    );
    console.log("REQUIRED NEXT STEP: toolspec review");
  } else {
    console.log("Approval status: pending (no cached draft found)");
    console.log("Run: toolspec review");
  }

  const observed = await getObservedToolSlugs();
  if (observed.length > 0) {
    const { publicTools, unknownTools } = partitionObservedTools(observed);
    console.log(
      `Observed tools: ${observed.length} (${publicTools.length} public, ${unknownTools.length} non-whitelist)`
    );
    console.log("Recommended:");
    console.log("  toolspec review");
    console.log("Direct submit modes:");
    console.log("  toolspec submit");
    console.log("  toolspec submit all");
    console.log("  toolspec submit all --yolo");
  } else {
    console.log("Observed tools: 0");
    console.log("No supported tool history found yet.");
    console.log("After using tools in Claude/Codex/Cursor, run:");
    console.log("  toolspec review");
  }

  console.log("Run 'toolspec help' for command reference.");
}

async function runApprove() {
  let draft = await readDraft();
  if (!draft || !draft.payload) {
    console.log("No cached draft found; preparing one now...");
    draft = await runPrepare({ silent: true });
  }

  let installRecord = await readInstallRecord();
  if (!hasInstallId(installRecord)) {
    installRecord = await ensureInstallRecord();
  }

  const payload = {
    ...draft.payload,
    install_id: installRecord.install_id
  };

  const response = await requestJson("POST", "/api/v1/reviews/submit", payload);
  console.log(JSON.stringify(response, null, 2));

  const now = new Date().toISOString();
  const state = await readState();
  await writeState({
    ...state,
    approved_at_utc: now,
    approval_required: false,
    last_approved_review_id: response?.review_id || null
  });

  await writeDraft({
    ...draft,
    payload,
    approved_at_utc: now,
    approved_review_id: response?.review_id || null
  });

  const observedCount = typeof response?.observed_tool_count === "number"
    ? response.observed_tool_count
    : draft?.summary?.observed_count;
  if (observedCount === 0) {
    console.log("Approval complete, but search remains locked.");
    console.log("Activation review had 0 observed tools.");
    console.log("After running tools in a session, run:");
    console.log("  toolspec review");
    return;
  }

  console.log("Approval complete. You can now run: toolspec search <keyword>");
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase();
}

function matchesKeyword(reviewRow, keywordLower) {
  const fields = [
    reviewRow.tool_slug,
    reviewRow.tool_name,
    reviewRow.category,
    reviewRow.recommendation,
    reviewRow.confidence,
    Array.isArray(reviewRow.agent_models) ? reviewRow.agent_models.join(" ") : ""
  ];

  return fields.some((field) => normalizeSearchText(field).includes(keywordLower));
}

async function runSearch(args) {
  const keyword = args.join(" ").trim();
  if (!keyword) {
    throw new Error("Usage: toolspec search <keyword>");
  }

  const state = await readState();
  if (!state.approved_at_utc) {
    throw new Error("Activation required before search. Run `toolspec review` first.");
  }

  const installRecord = await readInstallRecord();
  const installId = installRecord?.install_id;
  const suffix = typeof installId === "string" && installId.length > 0
    ? `?install_id=${encodeURIComponent(installId)}`
    : "";

  let accessStatus;
  try {
    accessStatus = await requestJson("GET", `/api/v1/access-status${suffix}`);
  } catch {
    throw new Error("Unable to verify access status. Run `toolspec verify` and try again.");
  }

  if (accessStatus?.submission_access !== "granted" || accessStatus?.post_install_required) {
    throw new Error(
      typeof accessStatus?.post_install_required_message === "string"
        ? accessStatus.post_install_required_message
        : "Search is locked. Run `toolspec review` after using tools in a real session."
    );
  }

  const payload = await requestJson("GET", "/api/reviews.json");
  const rows = Array.isArray(payload?.reviews) ? payload.reviews : [];
  const keywordLower = keyword.toLowerCase();

  const matches = rows.filter((row) => matchesKeyword(row, keywordLower));

  if (matches.length === 0) {
    console.log(`No reviews matched '${keyword}'.`);
    return;
  }

  console.log(`Matches for '${keyword}': ${matches.length}`);
  for (const row of matches.slice(0, 25)) {
    const errorPct = typeof row.error_rate === "number" ? `${(row.error_rate * 100).toFixed(1)}%` : "n/a";
    console.log(
      `- ${row.tool_slug} | ${row.tool_name} | ${row.recommendation}/${row.confidence} | error ${errorPct} | ${row.detail_url}`
    );
  }

  if (matches.length > 25) {
    console.log(`Showing first 25 of ${matches.length} results.`);
  }
}

async function runSubmit(rawArgs) {
  const { mode, yolo } = parseSubmitArgs(rawArgs);
  const installRecord = await ensureInstallRecord();
  const installId = typeof installRecord?.install_id === "string" ? installRecord.install_id : undefined;

  const now = new Date().toISOString();
  const token = crypto.randomUUID().replace(/-/g, "");
  const observedTools = await getObservedToolSlugs();
  const { publicTools, unknownTools } = partitionObservedTools(observedTools);

  let includedTools = [...publicTools];
  let redactedToolSlugs = [...unknownTools];

  if (mode === "all") {
    if (yolo) {
      includedTools = uniq([...publicTools, ...unknownTools]);
      redactedToolSlugs = [];
    } else if (unknownTools.length > 0) {
      const decision = await promptUnknownToolsOneByOne(unknownTools);
      if (decision.prompted) {
        includedTools = uniq([...publicTools, ...decision.included]);
        redactedToolSlugs = decision.redacted;
      } else {
        throw new Error(
          "Unknown non-whitelist tools require explicit choice. Re-run with `toolspec submit all --yolo` to include all unknown tools, or run `toolspec submit` for whitelist-only."
        );
      }
    }
  }

  const submittedTools = uniq(includedTools);

  const payload = buildPayload({
    installId,
    now,
    token,
    mode,
    yolo,
    observedTools,
    publicTools,
    unknownTools,
    submittedTools,
    redactedToolSlugs
  });

  const response = await requestJson("POST", "/api/v1/reviews/submit", payload);
  console.log(JSON.stringify(response, null, 2));
  console.log(
    `Submitted tools: ${submittedTools.length} | Redacted tools: ${redactedToolSlugs.length} | Mode: ${mode}${yolo ? " (yolo)" : ""}`
  );

  const state = await readState();
  await writeState({
    ...state,
    approved_at_utc: new Date().toISOString(),
    approval_required: false,
    last_approved_review_id: response?.review_id || null
  });

  if (redactedToolSlugs.length > 0) {
    console.log(`Redacted tool slugs: ${redactedToolSlugs.join(", ")}`);
  }
}

async function runReview() {
  const observedTools = await getObservedToolSlugs();
  const { publicTools, unknownTools } = partitionObservedTools(observedTools);

  console.log("ToolSpec review preview:");
  console.log("Source: local Claude/Codex/Cursor history + TOOLSPEC_OBSERVED_TOOLS");
  console.log(
    JSON.stringify(
      {
        observed_tools: observedTools.length,
        whitelisted_tools_to_submit: publicTools.length,
        non_whitelist_tools_redacted: unknownTools.length
      },
      null,
      2
    )
  );

  if (publicTools.length > 0) {
    console.log(`Submit list: ${publicTools.join(", ")}`);
  } else {
    console.log("Submit list: (none)");
  }

  if (unknownTools.length > 0) {
    console.log(`Redacted by default: ${unknownTools.join(", ")}`);
  }

  if (observedTools.length === 0) {
    console.log("No observed tools detected in supported history files.");
    console.log("If your history lives elsewhere, set TOOLSPEC_HISTORY_PATHS and re-run `toolspec review`.");
  }

  const shouldSubmit = await promptYesNo("Submit this review now? [y/N]: ");
  if (shouldSubmit === null) {
    console.log("Interactive prompt unavailable. Run `toolspec submit` to submit explicitly.");
    return;
  }

  if (!shouldSubmit) {
    console.log("Review not submitted.");
    return;
  }

  await runSubmit([]);
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

  await Promise.allSettled([
    fs.rm(INSTALL_FILE, { force: true }),
    fs.rm(STATE_FILE, { force: true }),
    fs.rm(DRAFT_FILE, { force: true }),
    fs.rm(WRAPPER_PATH, { force: true })
  ]);
  console.log("ToolSpec uninstalled.");
}

async function main() {
  const [, , rawCommand, ...args] = process.argv;
  const command = rawCommand || "status";

  switch (command) {
    case "install":
      await runInstall();
      return;
    case "status":
      await runStatus();
      return;
    case "verify":
      await runVerify();
      return;
    case "review":
      await runReview();
      return;
    case "prepare":
      await runPrepare();
      return;
    case "approve":
      await runApprove();
      return;
    case "search":
      await runSearch(args);
      return;
    case "submit":
      await runSubmit(args);
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
