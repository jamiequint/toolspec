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
    "ToolSpec CLI\n\nCommands:\n  toolspec install\n  toolspec status\n  toolspec verify\n  toolspec approve\n  toolspec search <keyword>\n  toolspec submit\n  toolspec submit all\n  toolspec submit all --yolo\n  toolspec uninstall"
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

function getObservedToolSlugs() {
  return parseCsvList(process.env.TOOLSPEC_OBSERVED_TOOLS || "");
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
  const observedTools = getObservedToolSlugs();
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
    console.log("Next step: toolspec approve");
  }

  return draft;
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
      console.log(`  export PATH=\"${BIN_DIR}:$PATH\"`);
    }
  } else {
    console.log("Add this directory to PATH for global access:");
    console.log(`  ${BIN_DIR}`);
  }

  await runPrepare({ silent: true });

  console.log(`ToolSpec installed: ${WRAPPER_PATH}`);
  const promptMessage = registerPayload?.post_install_prompt?.message;
  if (typeof promptMessage === "string" && promptMessage.length > 0) {
    console.log(promptMessage);
  }
  console.log("Prepared draft: yes (not submitted)");
  console.log("REQUIRED NEXT STEP: toolspec approve");
  console.log("Optional: toolspec verify");
  console.log("");
  console.log("Running post-install status check...");
  try {
    await runStatus();
  } catch {
    console.log("Could not run status automatically. Run: toolspec status");
  }
}

async function runVerify() {
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

  if (state.approved_at_utc) {
    console.log(`Approval status: approved at ${state.approved_at_utc}`);
    console.log("Search enabled: toolspec search <keyword>");
  } else if (draft?.summary) {
    console.log("Approval status: pending");
    console.log(
      `Draft summary: observed=${draft.summary.observed_count}, whitelist=${draft.summary.whitelist_count}, unknown=${draft.summary.unknown_count}, redacted=${draft.summary.redacted_count}`
    );
    console.log("REQUIRED NEXT STEP: toolspec approve");
  } else {
    console.log("Approval status: pending (no cached draft found)");
    console.log("Run: toolspec prepare");
    console.log("Then: toolspec approve");
  }

  const observed = getObservedToolSlugs();
  if (observed.length > 0) {
    const { publicTools, unknownTools } = partitionObservedTools(observed);
    console.log(
      `Observed tools: ${observed.length} (${publicTools.length} public, ${unknownTools.length} non-whitelist)`
    );
    console.log("Submit modes:");
    console.log("  toolspec submit");
    console.log("  toolspec submit all");
    console.log("  toolspec submit all --yolo");
  }

  console.log("Run 'toolspec help' for command reference.");
}

async function runApprove() {
  let draft = await readDraft();
  if (!draft || !draft.payload) {
    console.log("No cached draft found; preparing one now...");
    draft = await runPrepare({ silent: true });
  }

  const response = await requestJson("POST", "/api/v1/reviews/submit", draft.payload);
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
    approved_at_utc: now,
    approved_review_id: response?.review_id || null
  });

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
    throw new Error("Approval required before search. Run `toolspec approve` first.");
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
  const installRecord = await readInstallRecord();
  const installId = typeof installRecord?.install_id === "string" ? installRecord.install_id : undefined;

  const now = new Date().toISOString();
  const token = crypto.randomUUID().replace(/-/g, "");
  const observedTools = getObservedToolSlugs();
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
