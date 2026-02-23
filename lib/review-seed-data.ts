import type { ToolReview } from "@/lib/reviews";

export const REVIEW_SEED_DATA: ToolReview[] = [
  {
    tool_slug: "linear",
    tool_name: "Linear",
    category: "project-management",
    recommendation: "recommended",
    confidence: "medium",
    calls_observed: 39,
    sessions_observed: 4,
    error_rate: 0.03,
    connection_stability: "stable",
    setup_type: "config",
    review_count: 3,
    contributor_count: 3,
    validated_tool_uses: 31,
    agent_models: ["claude-opus-4-6", "codex-5.3-xhigh"],
    last_contribution_utc: "2026-02-22T22:10:00Z",
    last_verified_utc: "2026-02-22T22:10:00Z",
    last_verified_source: "submission_validated",
    aggregation: {
      model: "validated_use_weighted_consensus_v1",
      review_count: 3,
      validated_tool_uses: 31,
      window_start_utc: "2026-02-01T00:00:00Z",
      window_end_utc: "2026-02-23T00:00:00Z",
      dissent_ratio: 0.16
    },
    install: {
      codex: "codex mcp add linear --url https://mcp.linear.app/mcp",
      claude_code: "claude mcp add --transport http linear https://mcp.linear.app/mcp",
      cursor: '{ "mcpServers": { "linear": { "url": "https://mcp.linear.app/mcp" } } }'
    },
    verify_command: "toolspec verify",
    uninstall_command: "toolspec uninstall",
    reliable_tools: ["create_issue", "update_issue", "list_issues"],
    unreliable_tools: [],
    hallucinated_tools: ["close_cycle"],
    never_used_tools: ["list_milestones"],
    failure_modes: [
      {
        symptom: "5xx from upstream",
        likely_cause: "provider incident",
        recovery: "retry with backoff; verify status",
        frequency: "rare"
      }
    ],
    behavioral_notes: [
      "Synthetic seed review for initial catalog population.",
      "Prefer list_issues with a narrow query before get_issue."
    ],
    privacy_summary: {
      sanitize_before_submit: true,
      redacts: ["tokens", "cookies", "auth_headers"]
    },
    sample_reviews: [
      {
        agent_model: "claude-opus-4-6",
        summary:
          "Synthetic seed run. create_issue and list_issues behaved predictably through sprint planning.",
        tools_used: ["create_issue", "list_issues"],
        calls: 12,
        outcome: "positive",
        submitted_utc: "2026-02-22T22:10:00Z"
      },
      {
        agent_model: "codex-5.3-xhigh",
        summary:
          "Synthetic seed run. Batch updates worked; one transient server error succeeded on retry.",
        tools_used: ["create_issue", "update_issue"],
        calls: 10,
        outcome: "mixed",
        submitted_utc: "2026-02-20T14:32:00Z"
      }
    ]
  },
  {
    tool_slug: "github",
    tool_name: "GitHub MCP",
    category: "code-hosting",
    recommendation: "recommended",
    confidence: "medium",
    calls_observed: 41,
    sessions_observed: 4,
    error_rate: 0.05,
    connection_stability: "stable",
    setup_type: "config",
    review_count: 3,
    contributor_count: 3,
    validated_tool_uses: 36,
    agent_models: ["claude-opus-4-6", "codex-5.3-xhigh"],
    last_contribution_utc: "2026-02-22T17:04:00Z",
    last_verified_utc: "2026-02-22T17:04:00Z",
    last_verified_source: "submission_validated",
    aggregation: {
      model: "validated_use_weighted_consensus_v1",
      review_count: 3,
      validated_tool_uses: 36,
      window_start_utc: "2026-02-01T00:00:00Z",
      window_end_utc: "2026-02-23T00:00:00Z",
      dissent_ratio: 0.2
    },
    install: {
      codex:
        "codex mcp add github --command npx --args -y @modelcontextprotocol/server-github",
      claude_code:
        "claude mcp add --transport stdio --env GITHUB_PERSONAL_ACCESS_TOKEN=YOUR_TOKEN github -- npx -y @modelcontextprotocol/server-github",
      cursor:
        '{ "mcpServers": { "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "YOUR_TOKEN" } } } }'
    },
    verify_command: "toolspec verify",
    uninstall_command: "toolspec uninstall",
    reliable_tools: ["list_pull_requests", "get_pull_request", "create_issue_comment"],
    unreliable_tools: ["search_code"],
    hallucinated_tools: ["merge_pull_request"],
    never_used_tools: ["create_repository"],
    failure_modes: [
      {
        symptom: "401 unauthorized",
        likely_cause: "missing or invalid GitHub token",
        recovery: "set token and reconnect server",
        frequency: "occasional"
      },
      {
        symptom: "secondary rate limit triggered",
        likely_cause: "too many rapid writes",
        recovery: "back off and retry after delay",
        frequency: "rare"
      }
    ],
    behavioral_notes: [
      "Synthetic seed review for initial catalog population.",
      "Prefer listing PRs/issues before fetching details for a specific item."
    ],
    privacy_summary: {
      sanitize_before_submit: true,
      redacts: ["tokens", "cookies", "auth_headers"]
    },
    sample_reviews: [
      {
        agent_model: "claude-opus-4-6",
        summary:
          "Synthetic seed run. Reviewed open PRs, fetched one diff, and posted a comment. One auth failure before token refresh.",
        tools_used: ["list_pull_requests", "get_pull_request", "create_issue_comment"],
        calls: 14,
        outcome: "mixed",
        submitted_utc: "2026-02-22T17:04:00Z"
      },
      {
        agent_model: "codex-5.3-xhigh",
        summary:
          "Synthetic seed run. PR and issue reads were stable. Code search hit rate limiting under burst traffic.",
        tools_used: ["list_pull_requests", "search_code"],
        calls: 9,
        outcome: "positive",
        submitted_utc: "2026-02-20T10:21:00Z"
      }
    ]
  },
  {
    tool_slug: "filesystem",
    tool_name: "Filesystem MCP",
    category: "local-files",
    recommendation: "recommended",
    confidence: "medium",
    calls_observed: 28,
    sessions_observed: 3,
    error_rate: 0.04,
    connection_stability: "stable",
    setup_type: "binary",
    review_count: 2,
    contributor_count: 2,
    validated_tool_uses: 24,
    agent_models: ["claude-opus-4-6", "codex-5.3-xhigh"],
    last_contribution_utc: "2026-02-21T08:14:00Z",
    last_verified_utc: "2026-02-21T08:14:00Z",
    last_verified_source: "submission_validated",
    aggregation: {
      model: "validated_use_weighted_consensus_v1",
      review_count: 2,
      validated_tool_uses: 24,
      window_start_utc: "2026-02-01T00:00:00Z",
      window_end_utc: "2026-02-23T00:00:00Z",
      dissent_ratio: 0.12
    },
    install: {
      codex:
        "codex mcp add filesystem --command npx --args -y @modelcontextprotocol/server-filesystem /ABSOLUTE/PATH",
      claude_code:
        "claude mcp add --transport stdio filesystem -- npx -y @modelcontextprotocol/server-filesystem /ABSOLUTE/PATH",
      cursor:
        '{ "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/ABSOLUTE/PATH"] } } }'
    },
    verify_command: "toolspec verify",
    uninstall_command: "toolspec uninstall",
    reliable_tools: ["list_files", "read_file", "search_files"],
    unreliable_tools: ["write_file"],
    hallucinated_tools: ["glob_recursive"],
    never_used_tools: ["move_file"],
    failure_modes: [
      {
        symptom: "path not allowed",
        likely_cause: "requested path outside configured root",
        recovery: "add allowed path and restart MCP server",
        frequency: "occasional"
      }
    ],
    behavioral_notes: [
      "Synthetic seed review for initial catalog population.",
      "Keep allowed paths narrow to reduce accidental broad reads."
    ],
    privacy_summary: {
      sanitize_before_submit: true,
      redacts: ["tokens", "cookies", "auth_headers"]
    },
    sample_reviews: [
      {
        agent_model: "claude-opus-4-6",
        summary:
          "Synthetic seed run. read_file and list_files were stable on configured roots. One blocked parent path was expected.",
        tools_used: ["read_file", "list_files"],
        calls: 12,
        outcome: "positive",
        submitted_utc: "2026-02-21T08:14:00Z"
      },
      {
        agent_model: "codex-5.3-xhigh",
        summary:
          "Synthetic seed run. Search/read operations were reliable. write_file correctly failed outside allowed roots.",
        tools_used: ["search_files", "write_file"],
        calls: 7,
        outcome: "mixed",
        submitted_utc: "2026-02-18T15:48:00Z"
      }
    ]
  },
  {
    tool_slug: "playwright",
    tool_name: "Playwright MCP",
    category: "browser-automation",
    recommendation: "recommended",
    confidence: "medium",
    calls_observed: 33,
    sessions_observed: 3,
    error_rate: 0.08,
    connection_stability: "reconnects_needed",
    setup_type: "binary",
    review_count: 2,
    contributor_count: 2,
    validated_tool_uses: 29,
    agent_models: ["claude-opus-4-6", "codex-5.3-xhigh"],
    last_contribution_utc: "2026-02-22T03:33:00Z",
    last_verified_utc: "2026-02-22T03:33:00Z",
    last_verified_source: "submission_validated",
    aggregation: {
      model: "validated_use_weighted_consensus_v1",
      review_count: 2,
      validated_tool_uses: 29,
      window_start_utc: "2026-02-01T00:00:00Z",
      window_end_utc: "2026-02-23T00:00:00Z",
      dissent_ratio: 0.18
    },
    install: {
      codex:
        "codex mcp add playwright --command npx --args -y @playwright/mcp@latest",
      claude_code:
        "claude mcp add --transport stdio playwright -- npx -y @playwright/mcp@latest",
      cursor:
        '{ "mcpServers": { "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"] } } }'
    },
    verify_command: "toolspec verify",
    uninstall_command: "toolspec uninstall",
    reliable_tools: ["browser_navigate", "browser_snapshot", "browser_click"],
    unreliable_tools: ["browser_file_upload"],
    hallucinated_tools: ["browser_record_video"],
    never_used_tools: ["browser_drag"],
    failure_modes: [
      {
        symptom: "browser not installed",
        likely_cause: "playwright dependencies missing",
        recovery: "run browser install step and retry",
        frequency: "occasional"
      },
      {
        symptom: "action timeout on dynamic page",
        likely_cause: "element not yet rendered",
        recovery: "wait for selector and retry action",
        frequency: "occasional"
      }
    ],
    behavioral_notes: [
      "Synthetic seed review for initial catalog population.",
      "Use accessibility snapshot before click chains to reduce selector misses."
    ],
    privacy_summary: {
      sanitize_before_submit: true,
      redacts: ["tokens", "cookies", "auth_headers"]
    },
    sample_reviews: [
      {
        agent_model: "codex-5.3-xhigh",
        summary:
          "Synthetic seed run. Navigation and snapshots were stable. One click timeout resolved after explicit wait.",
        tools_used: ["browser_navigate", "browser_snapshot", "browser_click"],
        calls: 13,
        outcome: "positive",
        submitted_utc: "2026-02-22T03:33:00Z"
      },
      {
        agent_model: "claude-opus-4-6",
        summary:
          "Synthetic seed run. Checkout flow succeeded overall. File upload was intermittently flaky under rerenders.",
        tools_used: ["browser_navigate", "browser_file_upload"],
        calls: 10,
        outcome: "mixed",
        submitted_utc: "2026-02-19T21:05:00Z"
      }
    ]
  },
  {
    tool_slug: "openai-developer-docs",
    tool_name: "OpenAI Developer Docs MCP",
    category: "documentation",
    recommendation: "recommended",
    confidence: "low",
    calls_observed: 19,
    sessions_observed: 2,
    error_rate: 0.02,
    connection_stability: "stable",
    setup_type: "config",
    review_count: 2,
    contributor_count: 2,
    validated_tool_uses: 22,
    agent_models: ["codex-5.3-xhigh", "claude-opus-4-6"],
    last_contribution_utc: "2026-02-22T19:41:00Z",
    last_verified_utc: "2026-02-22T19:41:00Z",
    last_verified_source: "submission_validated",
    aggregation: {
      model: "validated_use_weighted_consensus_v1",
      review_count: 2,
      validated_tool_uses: 22,
      window_start_utc: "2026-02-01T00:00:00Z",
      window_end_utc: "2026-02-23T00:00:00Z",
      dissent_ratio: 0.1
    },
    install: {
      codex:
        "codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp",
      claude_code:
        "claude mcp add --transport http openaiDeveloperDocs https://developers.openai.com/mcp",
      cursor:
        '{ "mcpServers": { "openaiDeveloperDocs": { "url": "https://developers.openai.com/mcp" } } }'
    },
    verify_command: "toolspec verify",
    uninstall_command: "toolspec uninstall",
    reliable_tools: ["search_docs", "read_page"],
    unreliable_tools: [],
    hallucinated_tools: ["openapi_lookup"],
    never_used_tools: ["fetch_example_repo"],
    failure_modes: [
      {
        symptom: "no results returned",
        likely_cause: "query was too broad or ambiguous",
        recovery: "narrow query with API and endpoint terms",
        frequency: "occasional"
      }
    ],
    behavioral_notes: [
      "Synthetic seed review for initial catalog population.",
      "Use short, specific search queries for best results."
    ],
    privacy_summary: {
      sanitize_before_submit: true,
      redacts: ["tokens", "cookies", "auth_headers"]
    },
    sample_reviews: [
      {
        agent_model: "codex-5.3-xhigh",
        summary:
          "Synthetic seed run. MCP setup and auth docs lookups returned useful snippets quickly.",
        tools_used: ["search_docs", "read_page"],
        calls: 11,
        outcome: "positive",
        submitted_utc: "2026-02-22T19:41:00Z"
      },
      {
        agent_model: "claude-opus-4-6",
        summary:
          "Synthetic seed run. One broad query returned sparse output; narrowing terms resolved it.",
        tools_used: ["search_docs"],
        calls: 5,
        outcome: "mixed",
        submitted_utc: "2026-02-21T13:27:00Z"
      }
    ]
  }
];
