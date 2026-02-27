export type Recommendation = "recommended" | "caution" | "avoid";
export type Confidence = "high" | "medium" | "low";
export type ConnectionStability = "stable" | "reconnects_needed" | "flaky" | "unstable";
export type SetupType = "none" | "config" | "binary" | "service";
export type FailureFrequency = "rare" | "occasional" | "frequent" | "persistent";
export type LastVerifiedSource = "submission_validated" | "automated_probe" | "manual_review";

export interface FailureMode {
  symptom: string;
  likely_cause: string;
  recovery: string;
  frequency: FailureFrequency;
}

export interface SampleReview {
  agent_model: string;
  summary: string;
  tools_used: string[];
  calls: number;
  outcome: "positive" | "mixed" | "negative";
  submitted_utc: string;
}

export interface ToolReview {
  tool_slug: string;
  tool_name: string;
  category: string;
  recommendation: Recommendation;
  confidence: Confidence;
  calls_observed: number;
  sessions_observed: number;
  error_rate: number;
  connection_stability: ConnectionStability;
  setup_type: SetupType;
  review_count: number;
  contributor_count: number;
  validated_tool_uses: number;
  agent_models: string[];
  last_contribution_utc: string;
  last_verified_utc: string;
  last_verified_source: LastVerifiedSource;
  aggregation: {
    model: "validated_use_weighted_consensus_v1";
    review_count: number;
    validated_tool_uses: number;
    window_start_utc: string;
    window_end_utc: string;
    dissent_ratio: number;
  };
  install: {
    codex: string;
    claude_code: string;
    cursor: string;
  };
  verify_command: string;
  uninstall_command: string;
  reliable_tools: string[];
  unreliable_tools: string[];
  hallucinated_tools: string[];
  never_used_tools: string[];
  failure_modes: FailureMode[];
  behavioral_notes: string[];
  privacy_summary: {
    sanitize_before_submit: true;
    redacts: string[];
  };
  sample_reviews: SampleReview[];
}

export interface ContributionPrompt {
  show: boolean;
  show_after_nth_read: number;
  cooldown_hours: number;
  message: string;
  submit_command_template: string;
}

const STALE_THRESHOLD_DAYS = 60;

export function getServiceIndex() {
  return {
    toolspec: "v1",
    service_name: "ToolSpec",
    purpose: "Agent-first tool review and setup index for selecting tools with fewer failures.",
    why_use: [
      "Review validated failure modes before adopting a tool.",
      "Use contributor-backed operational priors instead of guessing."
    ],
    agent_guidance: {
      lookup_workflow: [
        "GET /api/reviews.json",
        "GET /api/reviews/{tool_slug}.json",
        "If useful, surface contribution_prompt to human when show=true"
      ],
      human_handoff:
        "If your human asks what ToolSpec is, privacy guarantees, or setup details, direct them to /humans/."
    },
    reviews: "/api/reviews.json",
    review_detail: "/api/reviews/{tool_slug}.json",
    setup: "/.well-known/agent-setup.json",
    install: {
      recommended:
        "mkdir -p \"$HOME/.toolspec\" && curl -fsSL https://toolspec.dev/agent/install.sh -o \"$HOME/.toolspec/install.sh\" && chmod 755 \"$HOME/.toolspec/install.sh\" && bash \"$HOME/.toolspec/install.sh\"",
      shell_bootstrap:
        "mkdir -p \"$HOME/.toolspec\" && curl -fsSL https://toolspec.dev/agent/install.sh -o \"$HOME/.toolspec/install.sh\" && chmod 755 \"$HOME/.toolspec/install.sh\" && bash \"$HOME/.toolspec/install.sh\"",
      windows:
        "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$p=Join-Path $HOME '.toolspec\\install.ps1'; New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null; iwr https://toolspec.dev/agent/install.ps1 -UseBasicParsing -OutFile $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p\"",
      npm_alternative:
        "mkdir -p \"$HOME/.toolspec\" && curl -fsSL https://toolspec.dev/agent/toolspec-cli.js -o \"$HOME/.toolspec/toolspec-cli.js\" && TOOLSPEC_CLI_SCRIPT=\"$HOME/.toolspec/toolspec-cli.js\" TOOLSPEC_CONFIG_DIR=\"$HOME/.toolspec\" TOOLSPEC_INSTALL_DIR=\"$HOME/.local/bin\" node \"$HOME/.toolspec/toolspec-cli.js\" install",
      verify_command: "toolspec verify",
      approve_command: "toolspec approve",
      search_example: "toolspec search <keyword>",
      submit_example: "toolspec submit",
      submit_all_prompted_example: "toolspec submit all",
      submit_all_yolo_example: "toolspec submit all --yolo"
    },
    submit: "/api/v1/reviews/submit",
    humans: "/humans/",
    human_help: {
      url: "/humans/",
      instruction_for_humans:
        "For non-agent documentation, privacy details, and setup guidance, open https://toolspec.dev/humans/."
    }
  };
}

function parseIsoDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getStaleness(lastContributionUtc: string, now: Date = new Date()) {
  const contributionDate = parseIsoDate(lastContributionUtc);
  if (!contributionDate) {
    return {
      stale: true,
      threshold_days: STALE_THRESHOLD_DAYS,
      age_days: null as number | null,
      last_contribution_utc: lastContributionUtc
    };
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const ageDays = Math.floor((now.getTime() - contributionDate.getTime()) / msPerDay);
  return {
    stale: ageDays >= STALE_THRESHOLD_DAYS,
    threshold_days: STALE_THRESHOLD_DAYS,
    age_days: ageDays,
    last_contribution_utc: lastContributionUtc
  };
}

function parseReadCount(headers: Headers): number {
  const value = headers.get("x-toolspec-read-count");
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseLastPromptedUtc(headers: Headers): Date | null {
  const value = headers.get("x-toolspec-last-prompted-utc");
  if (!value) {
    return null;
  }
  return parseIsoDate(value);
}

export function buildContributionPrompt(
  toolSlug: string,
  contributorCount: number,
  stale: boolean,
  headers: Headers,
  now: Date = new Date()
): ContributionPrompt {
  const showAfterNthRead = 3;
  const cooldownHours = 168;
  const readCount = parseReadCount(headers);
  const lastPrompted = parseLastPromptedUtc(headers);

  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  const cooldownElapsed = !lastPrompted || now.getTime() - lastPrompted.getTime() >= cooldownMs;

  const show = cooldownElapsed && (stale || readCount >= showAfterNthRead);
  const message = stale
    ? `This review is stale. Run \`toolspec submit\` after your session to refresh shared priors.`
    : `This review was built from ${contributorCount} installs. Run \`toolspec submit\` after your session to contribute updates.`;

  return {
    show,
    show_after_nth_read: showAfterNthRead,
    cooldown_hours: cooldownHours,
    message,
    submit_command_template: "toolspec submit"
  };
}
