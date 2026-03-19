import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import {
  embedTextWithOpenRouter,
  hasOpenRouterEmbeddingConfig
} from "@/lib/openrouter-embeddings";
import type { ReviewSubmission } from "@/lib/submission";
import type {
  Confidence,
  ConnectionStability,
  FailureFrequency,
  FailureMode,
  LastVerifiedSource,
  Recommendation,
  SampleReview,
  SetupType,
  ToolReview
} from "@/lib/reviews";

type ToolMetadataRow = QueryResultRow & {
  server_slug: string;
  metadata_json: unknown;
  is_synthetic: boolean | null;
};

type SubmissionInsertRow = QueryResultRow & {
  review_id: string;
  validated_tool_use_count: number;
};

type InstallStatusRow = QueryResultRow & {
  install_id: string;
  revoked_at: string | null;
};

type InstallSubmissionStatusRow = QueryResultRow & {
  first_any_submission_at: string | null;
  first_meaningful_submission_at: string | null;
};

type SubmissionAggregationRow = QueryResultRow & {
  server_slug: string;
  agent_model: string;
  install_id: string | null;
  validated_tool_use_count: number | null;
  total_usage_count: number | null;
  submission_json: unknown;
  submitted_at: string;
};

type ServerEmbeddingRow = QueryResultRow & {
  server_slug: string;
  model: string;
  source_text: string;
  embedding_json: unknown;
  updated_at: string;
};

type SyntheticVisibilityPolicy = "show" | "suppress_seeded_reviews" | "suppress_seeded_servers";

export interface RecommendationCandidate {
  server_slug: string;
  tool_name: string;
  category: string;
  review_count: number;
  recommended_count: number;
  caution_count: number;
  avoid_count: number;
  validated_tool_uses: number;
  total_usage_count: number;
  last_submitted_utc: string | null;
  source_text: string;
}

export interface StoredServerEmbedding {
  server_slug: string;
  model: string;
  source_text: string;
  embedding: number[];
  updated_at: string;
}

interface MetadataEntry {
  review: ToolReview;
  isSynthetic: boolean;
}

interface FailureModeCount {
  symptom: string;
  likely_cause: string;
  recovery: string;
  frequency: FailureFrequency;
  count: number;
}

interface SubmissionAggregate {
  review_count: number;
  validated_tool_uses: number;
  total_usage_count: number;
  recommended_count: number;
  caution_count: number;
  avoid_count: number;
  contributor_keys: Set<string>;
  agent_models: Set<string>;
  first_submitted_at: string | null;
  last_submitted_at: string | null;
  reliable_tools: Map<string, number>;
  unreliable_tools: Map<string, number>;
  hallucinated_tools: Map<string, number>;
  never_used_tools: Map<string, number>;
  behavioral_notes: Map<string, number>;
  failure_modes: Map<string, FailureModeCount>;
  sample_reviews: SampleReview[];
}

interface AggregatedReviewRow {
  review: ToolReview;
  recommended_count: number;
  caution_count: number;
  avoid_count: number;
  total_usage_count: number;
  source_text: string;
}

const fallbackInstalls = new Map<string, {
  install_secret: string;
  any_submission_at: string | null;
  first_submission_at: string | null;
  revoked_at: string | null;
}>();

let pool: Pool | null = null;
let ensurePromise: Promise<void> | null = null;
let syntheticBootstrapSqlPromise: Promise<string> | null = null;

const SYNTHETIC_BOOTSTRAP_SQL_PATH = path.join(
  process.cwd(),
  "db",
  "seed",
  "bootstrap-synthetic-reviews.sql"
);

function normalizeConnectionString(connectionString: string) {
  if (connectionString.includes("localhost") || connectionString.includes("127.0.0.1")) {
    return connectionString;
  }

  try {
    const url = new URL(connectionString);
    url.searchParams.set("sslmode", "no-verify");
    return url.toString();
  } catch {
    return connectionString;
  }
}

function hasDatabaseUrl() {
  return typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0;
}

function getSyntheticVisibilityPolicy(): SyntheticVisibilityPolicy {
  const raw = (process.env.TOOLSPEC_SYNTHETIC_POLICY ?? "show").trim().toLowerCase();
  if (raw === "suppress_seeded_reviews" || raw === "suppress_seeded_servers" || raw === "show") {
    return raw;
  }
  return "show";
}

function shouldIncludeServerByPolicy(
  policy: SyntheticVisibilityPolicy,
  isSynthetic: boolean,
  hasRealSubmissions: boolean
) {
  if (!isSynthetic) {
    return true;
  }

  if (policy === "show") {
    return true;
  }

  if (policy === "suppress_seeded_servers") {
    return false;
  }

  return hasRealSubmissions;
}

async function getSyntheticBootstrapSql() {
  if (!syntheticBootstrapSqlPromise) {
    syntheticBootstrapSqlPromise = readFile(SYNTHETIC_BOOTSTRAP_SQL_PATH, "utf8");
  }
  return syntheticBootstrapSqlPromise;
}

function countSyntheticBootstrapInserts(sql: string) {
  return (sql.match(/INSERT\s+INTO\s+tool_metadata/gi) ?? []).length;
}

async function bootstrapSyntheticMetadata(client: PoolClient) {
  const bootstrapSql = (await getSyntheticBootstrapSql()).trim();
  if (!bootstrapSql) {
    return 0;
  }

  await client.query(bootstrapSql);
  return countSyntheticBootstrapInserts(bootstrapSql);
}

function getPool() {
  if (!pool) {
    const rawConnectionString = process.env.DATABASE_URL;
    const connectionString = rawConnectionString ? normalizeConnectionString(rawConnectionString) : "";
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for DB-backed review store");
    }

    const ssl = connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false };
    pool = new Pool({
      connectionString,
      max: 4,
      ssl
    });
  }

  return pool;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function safeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values));
}

function dedupeAndSortStrings(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function safeNonNegativeInt(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function safeUnitRange(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < 0) {
    return 0;
  }
  if (parsed > 1) {
    return 1;
  }
  return parsed;
}

function safeRate(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(1, parsed);
}

function normalizeIsoString(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value : "";
  if (!text) {
    return fallback;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toISOString();
}

function toRecommendation(value: unknown, fallback: Recommendation = "caution"): Recommendation {
  if (value === "recommended" || value === "caution" || value === "avoid") {
    return value;
  }
  return fallback;
}

function toConfidence(value: unknown, fallback: Confidence = "low"): Confidence {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return fallback;
}

function toSetupType(value: unknown, fallback: SetupType = "none"): SetupType {
  if (value === "none" || value === "config" || value === "binary" || value === "service") {
    return value;
  }
  return fallback;
}

function toConnectionStability(
  value: unknown,
  fallback: ConnectionStability = "stable"
): ConnectionStability {
  if (value === "stable" || value === "reconnects_needed" || value === "flaky" || value === "unstable") {
    return value;
  }
  return fallback;
}

function toFailureFrequency(
  value: unknown,
  fallback: FailureFrequency = "occasional"
): FailureFrequency {
  if (value === "rare" || value === "occasional" || value === "frequent" || value === "persistent") {
    return value;
  }
  return fallback;
}

function toLastVerifiedSource(
  value: unknown,
  fallback: LastVerifiedSource = "manual_review"
): LastVerifiedSource {
  if (value === "submission_validated" || value === "automated_probe" || value === "manual_review") {
    return value;
  }
  return fallback;
}

function parseEmbeddingJson(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));

  return parsed.length > 0 ? parsed : null;
}

function parseFailureModes(value: unknown): FailureMode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: FailureMode[] = [];
  for (const mode of value) {
    if (!isObject(mode)) {
      continue;
    }

    const symptom = safeString(mode.symptom);
    const likelyCause = safeString(mode.likely_cause);
    const recovery = safeString(mode.recovery);
    if (!symptom || !likelyCause || !recovery) {
      continue;
    }

    parsed.push({
      symptom,
      likely_cause: likelyCause,
      recovery,
      frequency: toFailureFrequency(mode.frequency)
    });
  }

  return parsed;
}

function parseSampleReviews(value: unknown): SampleReview[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: SampleReview[] = [];
  for (const item of value) {
    if (!isObject(item)) {
      continue;
    }

    const agentModel = safeString(item.agent_model);
    const summary = safeString(item.summary);
    const submittedUtc = safeString(item.submitted_utc);
    if (!agentModel || !summary || !submittedUtc) {
      continue;
    }

    const toolsUsed = dedupeAndSortStrings(safeStringArray(item.tools_used));
    const calls = safeNonNegativeInt(item.calls, 0);
    const outcome = item.outcome === "positive" || item.outcome === "mixed" || item.outcome === "negative"
      ? item.outcome
      : "mixed";

    parsed.push({
      agent_model: agentModel,
      summary,
      tools_used: toolsUsed,
      calls,
      outcome,
      submitted_utc: normalizeIsoString(submittedUtc, new Date().toISOString())
    });
  }

  return parsed;
}

function titleFromSlug(serverSlug: string) {
  return serverSlug
    .split(/[-_]/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildDefaultReview(serverSlug: string): ToolReview {
  const now = new Date().toISOString();
  return {
    server_slug: serverSlug,
    tool_name: titleFromSlug(serverSlug) || serverSlug,
    category: "mcp_server",
    recommendation: "caution",
    confidence: "low",
    calls_observed: 0,
    sessions_observed: 0,
    error_rate: 0,
    connection_stability: "stable",
    setup_type: "none",
    review_count: 0,
    contributor_count: 0,
    validated_tool_uses: 0,
    agent_models: [],
    last_contribution_utc: now,
    last_verified_utc: now,
    last_verified_source: "manual_review",
    aggregation: {
      model: "validated_use_weighted_consensus_v1",
      review_count: 0,
      validated_tool_uses: 0,
      window_start_utc: now,
      window_end_utc: now,
      dissent_ratio: 0
    },
    install: {
      codex: "",
      claude_code: "",
      cursor: ""
    },
    verify_command: "toolspec verify",
    uninstall_command: "toolspec uninstall",
    reliable_tools: [],
    unreliable_tools: [],
    hallucinated_tools: [],
    never_used_tools: [],
    failure_modes: [],
    behavioral_notes: [],
    privacy_summary: {
      sanitize_before_submit: true,
      redacts: ["tokens", "cookies", "auth_headers"]
    },
    sample_reviews: []
  };
}

function buildReviewFromMetadata(serverSlug: string, metadataJson: unknown): ToolReview {
  const base = buildDefaultReview(serverSlug);
  if (!isObject(metadataJson)) {
    return base;
  }

  const installObj = isObject(metadataJson.install) ? metadataJson.install : {};
  const privacyObj = isObject(metadataJson.privacy_summary) ? metadataJson.privacy_summary : {};
  const aggregationObj = isObject(metadataJson.aggregation) ? metadataJson.aggregation : {};

  const review: ToolReview = {
    ...base,
    server_slug: serverSlug,
    tool_name: safeString(metadataJson.tool_name, base.tool_name),
    category: safeString(metadataJson.category, base.category),
    recommendation: toRecommendation(metadataJson.recommendation, base.recommendation),
    confidence: toConfidence(metadataJson.confidence, base.confidence),
    calls_observed: safeNonNegativeInt(metadataJson.calls_observed, base.calls_observed),
    sessions_observed: safeNonNegativeInt(metadataJson.sessions_observed, base.sessions_observed),
    error_rate: safeRate(metadataJson.error_rate, base.error_rate),
    connection_stability: toConnectionStability(metadataJson.connection_stability, base.connection_stability),
    setup_type: toSetupType(metadataJson.setup_type, base.setup_type),
    review_count: safeNonNegativeInt(metadataJson.review_count, base.review_count),
    contributor_count: safeNonNegativeInt(metadataJson.contributor_count, base.contributor_count),
    validated_tool_uses: safeNonNegativeInt(metadataJson.validated_tool_uses, base.validated_tool_uses),
    agent_models: dedupeAndSortStrings(safeStringArray(metadataJson.agent_models)),
    last_contribution_utc: normalizeIsoString(metadataJson.last_contribution_utc, base.last_contribution_utc),
    last_verified_utc: normalizeIsoString(metadataJson.last_verified_utc, base.last_verified_utc),
    last_verified_source: toLastVerifiedSource(metadataJson.last_verified_source, base.last_verified_source),
    aggregation: {
      model: "validated_use_weighted_consensus_v1",
      review_count: safeNonNegativeInt(aggregationObj.review_count, safeNonNegativeInt(metadataJson.review_count, base.aggregation.review_count)),
      validated_tool_uses: safeNonNegativeInt(
        aggregationObj.validated_tool_uses,
        safeNonNegativeInt(metadataJson.validated_tool_uses, base.aggregation.validated_tool_uses)
      ),
      window_start_utc: normalizeIsoString(aggregationObj.window_start_utc, base.aggregation.window_start_utc),
      window_end_utc: normalizeIsoString(aggregationObj.window_end_utc, base.aggregation.window_end_utc),
      dissent_ratio: safeUnitRange(aggregationObj.dissent_ratio, base.aggregation.dissent_ratio)
    },
    install: {
      codex: safeString(installObj.codex, base.install.codex),
      claude_code: safeString(installObj.claude_code, base.install.claude_code),
      cursor: safeString(installObj.cursor, base.install.cursor)
    },
    verify_command: safeString(metadataJson.verify_command, base.verify_command),
    uninstall_command: safeString(metadataJson.uninstall_command, base.uninstall_command),
    reliable_tools: dedupeAndSortStrings(safeStringArray(metadataJson.reliable_tools)),
    unreliable_tools: dedupeAndSortStrings(safeStringArray(metadataJson.unreliable_tools)),
    hallucinated_tools: dedupeAndSortStrings(safeStringArray(metadataJson.hallucinated_tools)),
    never_used_tools: dedupeAndSortStrings(safeStringArray(metadataJson.never_used_tools)),
    failure_modes: parseFailureModes(metadataJson.failure_modes),
    behavioral_notes: dedupeStrings(safeStringArray(metadataJson.behavioral_notes)),
    privacy_summary: {
      sanitize_before_submit: true,
      redacts: dedupeAndSortStrings(safeStringArray(privacyObj.redacts))
    },
    sample_reviews: parseSampleReviews(metadataJson.sample_reviews)
  };

  if (review.privacy_summary.redacts.length === 0) {
    review.privacy_summary.redacts = base.privacy_summary.redacts;
  }

  if (review.contributor_count === 0 && review.review_count > 0) {
    review.contributor_count = review.review_count;
  }

  return review;
}

function createAggregate(): SubmissionAggregate {
  return {
    review_count: 0,
    validated_tool_uses: 0,
    total_usage_count: 0,
    recommended_count: 0,
    caution_count: 0,
    avoid_count: 0,
    contributor_keys: new Set<string>(),
    agent_models: new Set<string>(),
    first_submitted_at: null,
    last_submitted_at: null,
    reliable_tools: new Map<string, number>(),
    unreliable_tools: new Map<string, number>(),
    hallucinated_tools: new Map<string, number>(),
    never_used_tools: new Map<string, number>(),
    behavioral_notes: new Map<string, number>(),
    failure_modes: new Map<string, FailureModeCount>(),
    sample_reviews: []
  };
}

function incrementCount(map: Map<string, number>, key: string, amount = 1) {
  if (!key) {
    return;
  }
  map.set(key, (map.get(key) ?? 0) + amount);
}

function upsertFailureCount(map: Map<string, FailureModeCount>, mode: FailureMode) {
  const key = [mode.symptom, mode.likely_cause, mode.recovery, mode.frequency].join("\u0000");
  const current = map.get(key);
  if (current) {
    current.count += 1;
    map.set(key, current);
    return;
  }

  map.set(key, {
    symptom: mode.symptom,
    likely_cause: mode.likely_cause,
    recovery: mode.recovery,
    frequency: mode.frequency,
    count: 1
  });
}

function maxIso(a: string | null, b: string) {
  if (!a) {
    return b;
  }
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function minIso(a: string | null, b: string) {
  if (!a) {
    return b;
  }
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

function outcomeFromRecommendation(recommendation: Recommendation): "positive" | "mixed" | "negative" {
  if (recommendation === "recommended") {
    return "positive";
  }
  if (recommendation === "avoid") {
    return "negative";
  }
  return "mixed";
}

function addSubmissionToAggregate(bucket: SubmissionAggregate, row: SubmissionAggregationRow) {
  const submission = isObject(row.submission_json) ? row.submission_json : {};

  const recommendation = toRecommendation(submission.recommendation);
  const reliableTools = dedupeStrings(safeStringArray(submission.reliable_tools));
  const unreliableTools = dedupeStrings(safeStringArray(submission.unreliable_tools));
  const hallucinatedTools = dedupeStrings(safeStringArray(submission.hallucinated_tools));
  const neverUsedTools = dedupeStrings(safeStringArray(submission.never_used_tools));
  const behavioralNotes = dedupeStrings(safeStringArray(submission.behavioral_notes));
  const failureModes = parseFailureModes(submission.failure_modes);

  const validatedToolUseCount = safeNonNegativeInt(
    row.validated_tool_use_count,
    Array.isArray(submission.evidence) ? submission.evidence.length : 0
  );
  const totalUsageCount = safeNonNegativeInt(
    row.total_usage_count,
    safeNonNegativeInt(submission.total_usage_count, 0)
  );

  const agentModel = safeString(row.agent_model, safeString(submission.agent_model, "unknown"));
  const installId = safeString(row.install_id);
  const contributorKey = installId ? `install:${installId}` : `model:${agentModel}`;

  const submittedAt = normalizeIsoString(row.submitted_at, new Date().toISOString());

  bucket.review_count += 1;
  bucket.validated_tool_uses += validatedToolUseCount;
  bucket.total_usage_count += totalUsageCount;
  bucket.contributor_keys.add(contributorKey);
  bucket.agent_models.add(agentModel);
  bucket.first_submitted_at = minIso(bucket.first_submitted_at, submittedAt);
  bucket.last_submitted_at = maxIso(bucket.last_submitted_at, submittedAt);

  if (recommendation === "recommended") {
    bucket.recommended_count += 1;
  } else if (recommendation === "caution") {
    bucket.caution_count += 1;
  } else {
    bucket.avoid_count += 1;
  }

  for (const tool of reliableTools) {
    incrementCount(bucket.reliable_tools, tool);
  }
  for (const tool of unreliableTools) {
    incrementCount(bucket.unreliable_tools, tool);
  }
  for (const tool of hallucinatedTools) {
    incrementCount(bucket.hallucinated_tools, tool);
  }
  for (const tool of neverUsedTools) {
    incrementCount(bucket.never_used_tools, tool);
  }

  for (const note of behavioralNotes) {
    incrementCount(bucket.behavioral_notes, note);
  }

  for (const mode of failureModes) {
    upsertFailureCount(bucket.failure_modes, mode);
  }

  if (bucket.sample_reviews.length < 24) {
    const toolsUsed = dedupeStrings([
      ...reliableTools,
      ...unreliableTools,
      ...hallucinatedTools
    ]).slice(0, 10);

    const summary = behavioralNotes[0]
      ?? `Observed ${reliableTools.length} reliable and ${unreliableTools.length} unreliable tools.`;

    bucket.sample_reviews.push({
      agent_model: agentModel,
      summary,
      tools_used: toolsUsed,
      calls: totalUsageCount > 0 ? totalUsageCount : validatedToolUseCount,
      outcome: outcomeFromRecommendation(recommendation),
      submitted_utc: submittedAt
    });
  }
}

function topStringCounts(map: Map<string, number>, limit: number) {
  return Array.from(map.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([value]) => value);
}

function topFailureModes(map: Map<string, FailureModeCount>, limit: number): FailureMode[] {
  return Array.from(map.values())
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.symptom.localeCompare(right.symptom);
    })
    .slice(0, limit)
    .map(({ count: _count, ...mode }) => mode);
}

function deriveRecommendation(bucket: SubmissionAggregate): Recommendation {
  const total = bucket.review_count;
  if (total <= 0) {
    return "caution";
  }

  const score = (
    bucket.recommended_count
    + (0.25 * bucket.caution_count)
    - bucket.avoid_count
  ) / total;

  if (score >= 0.3) {
    return "recommended";
  }
  if (score <= -0.3) {
    return "avoid";
  }
  return "caution";
}

function deriveConfidence(bucket: SubmissionAggregate, dissentRatio: number): Confidence {
  if (
    bucket.review_count >= 6
    && bucket.validated_tool_uses >= 120
    && dissentRatio <= 0.25
  ) {
    return "high";
  }

  if (bucket.review_count >= 2 && bucket.validated_tool_uses >= 20) {
    return "medium";
  }

  return "low";
}

function deriveErrorRate(bucket: SubmissionAggregate, fallback: number) {
  if (bucket.review_count <= 0) {
    return fallback;
  }

  const reliable = Array.from(bucket.reliable_tools.values()).reduce((sum, count) => sum + count, 0);
  const unreliable = Array.from(bucket.unreliable_tools.values()).reduce((sum, count) => sum + count, 0);
  const hallucinated = Array.from(bucket.hallucinated_tools.values()).reduce((sum, count) => sum + count, 0);

  const totalSignals = reliable + unreliable + hallucinated;
  const toolFailureSignal = totalSignals > 0
    ? (unreliable + (1.5 * hallucinated)) / Math.max(totalSignals, 1)
    : 0;

  const recommendationSignal = (
    bucket.avoid_count
    + (0.5 * bucket.caution_count)
  ) / Math.max(bucket.review_count, 1);

  const raw = (0.65 * toolFailureSignal) + (0.35 * recommendationSignal);
  const bounded = Math.max(0, Math.min(raw, 0.95));
  return Number(bounded.toFixed(4));
}

function deriveConnectionStability(
  errorRate: number,
  fallback: ConnectionStability
): ConnectionStability {
  if (!Number.isFinite(errorRate)) {
    return fallback;
  }

  if (errorRate <= 0.08) {
    return "stable";
  }
  if (errorRate <= 0.18) {
    return "reconnects_needed";
  }
  if (errorRate <= 0.32) {
    return "flaky";
  }
  return "unstable";
}

function buildReviewFromAggregate(
  serverSlug: string,
  metadataReview: ToolReview | null,
  bucket: SubmissionAggregate
): ToolReview {
  const base = metadataReview ?? buildDefaultReview(serverSlug);

  const reviewCount = bucket.review_count;
  const validatedToolUses = bucket.validated_tool_uses;
  const callsObserved = bucket.total_usage_count > 0 ? bucket.total_usage_count : validatedToolUses;
  const sessionsObserved = reviewCount;

  const recommendedCount = bucket.recommended_count;
  const cautionCount = bucket.caution_count;
  const avoidCount = bucket.avoid_count;

  const maxBucket = Math.max(recommendedCount, cautionCount, avoidCount, 0);
  const dissentRatio = reviewCount > 0
    ? Number((1 - (maxBucket / reviewCount)).toFixed(4))
    : 0;

  const recommendation = deriveRecommendation(bucket);
  const confidence = deriveConfidence(bucket, dissentRatio);
  const errorRate = deriveErrorRate(bucket, base.error_rate);

  const lastContributionUtc = bucket.last_submitted_at ?? base.last_contribution_utc;
  const windowStartUtc = bucket.first_submitted_at ?? lastContributionUtc;
  const windowEndUtc = bucket.last_submitted_at ?? lastContributionUtc;

  const reliableTools = topStringCounts(bucket.reliable_tools, 16);
  const unreliableTools = topStringCounts(bucket.unreliable_tools, 16);
  const hallucinatedTools = topStringCounts(bucket.hallucinated_tools, 16);
  const neverUsedTools = topStringCounts(bucket.never_used_tools, 16);
  const behavioralNotes = topStringCounts(bucket.behavioral_notes, 10);
  const failureModes = topFailureModes(bucket.failure_modes, 10);

  const agentModels = Array.from(bucket.agent_models).sort((a, b) => a.localeCompare(b));
  const contributorCount = Math.max(bucket.contributor_keys.size, agentModels.length, reviewCount > 0 ? 1 : 0);

  const sampleReviews = bucket.sample_reviews.length > 0
    ? bucket.sample_reviews.slice(0, 12)
    : base.sample_reviews;

  return {
    ...base,
    server_slug: serverSlug,
    recommendation,
    confidence,
    calls_observed: callsObserved,
    sessions_observed: sessionsObserved,
    error_rate: errorRate,
    connection_stability: deriveConnectionStability(errorRate, base.connection_stability),
    review_count: reviewCount,
    contributor_count: contributorCount,
    validated_tool_uses: validatedToolUses,
    agent_models: agentModels,
    last_contribution_utc: lastContributionUtc,
    last_verified_utc: lastContributionUtc,
    last_verified_source: "submission_validated",
    aggregation: {
      model: "validated_use_weighted_consensus_v1",
      review_count: reviewCount,
      validated_tool_uses: validatedToolUses,
      window_start_utc: windowStartUtc,
      window_end_utc: windowEndUtc,
      dissent_ratio: dissentRatio
    },
    reliable_tools: reliableTools.length > 0 ? reliableTools : base.reliable_tools,
    unreliable_tools: unreliableTools.length > 0 ? unreliableTools : base.unreliable_tools,
    hallucinated_tools: hallucinatedTools.length > 0 ? hallucinatedTools : base.hallucinated_tools,
    never_used_tools: neverUsedTools.length > 0 ? neverUsedTools : base.never_used_tools,
    failure_modes: failureModes.length > 0 ? failureModes : base.failure_modes,
    behavioral_notes: behavioralNotes.length > 0 ? behavioralNotes : base.behavioral_notes,
    sample_reviews: sampleReviews
  };
}

function buildRecommendationSourceText(review: ToolReview) {
  return [
    review.server_slug,
    review.tool_name,
    review.category,
    review.behavioral_notes.join(" "),
    review.reliable_tools.join(" "),
    review.unreliable_tools.join(" "),
    review.install.codex,
    review.install.claude_code,
    review.install.cursor
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEmbeddingSourceText(submission: ReviewSubmission) {
  const lines: string[] = [
    `server: ${submission.server_slug}`,
    `recommendation: ${submission.recommendation}`,
    `confidence: ${submission.confidence}`
  ];

  if (Array.isArray(submission.reliable_tools) && submission.reliable_tools.length > 0) {
    lines.push(`reliable_tools: ${submission.reliable_tools.join(", ")}`);
  }

  if (Array.isArray(submission.unreliable_tools) && submission.unreliable_tools.length > 0) {
    lines.push(`unreliable_tools: ${submission.unreliable_tools.join(", ")}`);
  }

  if (Array.isArray(submission.behavioral_notes) && submission.behavioral_notes.length > 0) {
    lines.push(`behavioral_notes: ${submission.behavioral_notes.join(" ")}`);
  }

  if (Array.isArray(submission.failure_modes) && submission.failure_modes.length > 0) {
    const failureText = submission.failure_modes
      .map((mode) => `${mode.symptom}; cause=${mode.likely_cause}; recovery=${mode.recovery}`)
      .join(" ");
    lines.push(`failure_modes: ${failureText}`);
  }

  return lines.join("\n").slice(0, 8000);
}

async function ensureDbReady() {
  if (!hasDatabaseUrl()) {
    return;
  }

  if (!ensurePromise) {
    ensurePromise = (async () => {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");

        await client.query(`
          CREATE TABLE IF NOT EXISTS tool_metadata (
            server_slug TEXT PRIMARY KEY,
            metadata_json JSONB NOT NULL,
            is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS tool_installs (
            install_id TEXT PRIMARY KEY,
            install_secret TEXT NOT NULL,
            secret_version INTEGER NOT NULL DEFAULT 1,
            first_submission_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS review_submissions (
            review_id TEXT PRIMARY KEY,
            server_slug TEXT NOT NULL,
            agent_model TEXT NOT NULL,
            install_id TEXT,
            idempotency_key TEXT NOT NULL UNIQUE,
            validated_tool_use_count INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'submitted',
            submission_json JSONB NOT NULL,
            submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS server_embeddings (
            server_slug TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            source_text TEXT NOT NULL,
            embedding_json JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'tool_metadata'
                AND column_name = 'tool_slug'
            ) AND NOT EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'tool_metadata'
                AND column_name = 'server_slug'
            ) THEN
              ALTER TABLE tool_metadata RENAME COLUMN tool_slug TO server_slug;
            END IF;
          END $$;
        `);

        await client.query(`
          DO $$
          BEGIN
            IF to_regclass('public.tool_reviews') IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'tool_reviews'
                  AND column_name = 'tool_slug'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'tool_reviews'
                  AND column_name = 'server_slug'
              ) THEN
              ALTER TABLE tool_reviews RENAME COLUMN tool_slug TO server_slug;
            END IF;
          END $$;
        `);

        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'review_submissions'
                AND column_name = 'tool_slug'
            ) AND NOT EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'review_submissions'
                AND column_name = 'server_slug'
            ) THEN
              ALTER TABLE review_submissions RENAME COLUMN tool_slug TO server_slug;
            END IF;
          END $$;
        `);

        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'server_embeddings'
                AND column_name = 'tool_slug'
            ) AND NOT EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'server_embeddings'
                AND column_name = 'server_slug'
            ) THEN
              ALTER TABLE server_embeddings RENAME COLUMN tool_slug TO server_slug;
            END IF;
          END $$;
        `);

        await client.query(`
          DO $$
          BEGIN
            IF to_regclass('public.tool_reviews') IS NOT NULL THEN
              EXECUTE '
                INSERT INTO tool_metadata (server_slug, metadata_json, is_synthetic, created_at, updated_at)
                SELECT
                  server_slug,
                  review_json,
                  COALESCE(is_synthetic, TRUE),
                  COALESCE(created_at, NOW()),
                  COALESCE(updated_at, NOW())
                FROM tool_reviews
                ON CONFLICT (server_slug)
                DO UPDATE SET
                  metadata_json = EXCLUDED.metadata_json,
                  is_synthetic = EXCLUDED.is_synthetic,
                  updated_at = NOW()
                WHERE tool_metadata.is_synthetic = TRUE
              ';
            END IF;
          END $$;
        `);

        await client.query(
          "ALTER TABLE review_submissions ADD COLUMN IF NOT EXISTS install_id TEXT"
        );

        await client.query(
          "ALTER TABLE review_submissions ADD COLUMN IF NOT EXISTS total_usage_count INTEGER DEFAULT 0"
        );

        await client.query(
          "CREATE INDEX IF NOT EXISTS review_submissions_server_slug_idx ON review_submissions (server_slug)"
        );

        await client.query("DELETE FROM tool_metadata WHERE server_slug = 'groundeffect'");

        const existingCountResult = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM tool_metadata"
        );
        const existingCount = Number.parseInt(existingCountResult.rows[0]?.count ?? "0", 10);

        if (existingCount === 0) {
          await bootstrapSyntheticMetadata(client);
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })();
  }

  await ensurePromise;
}

async function loadMetadataMap(serverSlugs?: string[]): Promise<Map<string, MetadataEntry>> {
  const map = new Map<string, MetadataEntry>();

  const rows = serverSlugs && serverSlugs.length > 0
    ? await getPool().query<ToolMetadataRow>(
      "SELECT server_slug, metadata_json, is_synthetic FROM tool_metadata WHERE server_slug = ANY($1::text[])",
      [serverSlugs]
    )
    : await getPool().query<ToolMetadataRow>(
      "SELECT server_slug, metadata_json, is_synthetic FROM tool_metadata"
    );

  for (const row of rows.rows) {
    const serverSlug = safeString(row.server_slug);
    if (!serverSlug) {
      continue;
    }

    map.set(serverSlug, {
      review: buildReviewFromMetadata(serverSlug, row.metadata_json),
      isSynthetic: row.is_synthetic === true
    });
  }

  return map;
}

async function loadSubmissionRows(serverSlugs?: string[]) {
  const rows = serverSlugs && serverSlugs.length > 0
    ? await getPool().query<SubmissionAggregationRow>(
      `
        SELECT
          server_slug,
          agent_model,
          install_id,
          validated_tool_use_count,
          COALESCE(total_usage_count, 0) AS total_usage_count,
          submission_json,
          submitted_at::text
        FROM review_submissions
        WHERE server_slug = ANY($1::text[])
        ORDER BY submitted_at DESC
      `,
      [serverSlugs]
    )
    : await getPool().query<SubmissionAggregationRow>(
      `
        SELECT
          server_slug,
          agent_model,
          install_id,
          validated_tool_use_count,
          COALESCE(total_usage_count, 0) AS total_usage_count,
          submission_json,
          submitted_at::text
        FROM review_submissions
        ORDER BY submitted_at DESC
      `
    );

  return rows.rows;
}

async function listAggregatedReviewRows(serverSlugs?: string[]): Promise<AggregatedReviewRow[]> {
  if (!hasDatabaseUrl()) {
    return [];
  }

  await ensureDbReady();

  const metadataMap = await loadMetadataMap(serverSlugs);
  const submissionRows = await loadSubmissionRows(serverSlugs);

  const aggregateMap = new Map<string, SubmissionAggregate>();
  for (const row of submissionRows) {
    const serverSlug = safeString(row.server_slug);
    if (!serverSlug) {
      continue;
    }

    const bucket = aggregateMap.get(serverSlug) ?? createAggregate();
    addSubmissionToAggregate(bucket, row);
    aggregateMap.set(serverSlug, bucket);
  }

  const slugSet = new Set<string>();
  for (const slug of metadataMap.keys()) {
    slugSet.add(slug);
  }
  for (const slug of aggregateMap.keys()) {
    slugSet.add(slug);
  }

  const policy = getSyntheticVisibilityPolicy();
  const rows: AggregatedReviewRow[] = [];

  for (const slug of slugSet) {
    const metadataEntry = metadataMap.get(slug);
    const aggregate = aggregateMap.get(slug);
    const hasRealSubmissions = !!aggregate;

    if (!shouldIncludeServerByPolicy(policy, metadataEntry?.isSynthetic ?? false, hasRealSubmissions)) {
      continue;
    }

    const review = aggregate
      ? buildReviewFromAggregate(slug, metadataEntry?.review ?? null, aggregate)
      : metadataEntry?.review ?? null;

    if (!review) {
      continue;
    }

    const recommendedCount = aggregate
      ? aggregate.recommended_count
      : review.recommendation === "recommended"
        ? review.review_count
        : 0;

    const cautionCount = aggregate
      ? aggregate.caution_count
      : review.recommendation === "caution"
        ? review.review_count
        : 0;

    const avoidCount = aggregate
      ? aggregate.avoid_count
      : review.recommendation === "avoid"
        ? review.review_count
        : 0;

    rows.push({
      review,
      recommended_count: recommendedCount,
      caution_count: cautionCount,
      avoid_count: avoidCount,
      total_usage_count: aggregate
        ? (aggregate.total_usage_count > 0 ? aggregate.total_usage_count : aggregate.validated_tool_uses)
        : review.calls_observed,
      source_text: buildRecommendationSourceText(review)
    });
  }

  rows.sort((left, right) => left.review.server_slug.localeCompare(right.review.server_slug));
  return rows;
}

export async function getAllReviews(agentFilter?: string): Promise<ToolReview[]> {
  if (!hasDatabaseUrl()) {
    return [];
  }

  const rows = await listAggregatedReviewRows();
  const allReviews = rows.map((row) => row.review);

  if (!agentFilter) {
    return allReviews;
  }

  return allReviews.filter((review) => review.agent_models.includes(agentFilter));
}

export async function getReviewByServerSlug(serverSlug: string): Promise<ToolReview | null> {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const rows = await listAggregatedReviewRows([serverSlug]);
  return rows[0]?.review ?? null;
}

export async function upsertServerEmbedding(serverSlug: string, sourceText: string) {
  if (!hasDatabaseUrl() || !hasOpenRouterEmbeddingConfig()) {
    return;
  }

  await ensureDbReady();
  const embedded = await embedTextWithOpenRouter(sourceText);
  if (!embedded) {
    return;
  }

  await getPool().query(
    `
      INSERT INTO server_embeddings (server_slug, model, source_text, embedding_json, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, NOW())
      ON CONFLICT (server_slug)
      DO UPDATE SET
        model = EXCLUDED.model,
        source_text = EXCLUDED.source_text,
        embedding_json = EXCLUDED.embedding_json,
        updated_at = NOW()
    `,
    [serverSlug, embedded.model, sourceText, JSON.stringify(embedded.embedding)]
  );
}

export async function getServerEmbeddings(serverSlugs: string[]): Promise<Map<string, StoredServerEmbedding>> {
  const map = new Map<string, StoredServerEmbedding>();

  if (serverSlugs.length === 0) {
    return map;
  }

  if (!hasDatabaseUrl()) {
    return map;
  }

  await ensureDbReady();
  const rows = await getPool().query<ServerEmbeddingRow>(
    `
      SELECT server_slug, model, source_text, embedding_json, updated_at::text
      FROM server_embeddings
      WHERE server_slug = ANY($1::text[])
    `,
    [serverSlugs]
  );

  for (const row of rows.rows) {
    const embedding = parseEmbeddingJson(row.embedding_json);
    if (!embedding) {
      continue;
    }

    map.set(row.server_slug, {
      server_slug: row.server_slug,
      model: safeString(row.model),
      source_text: safeString(row.source_text),
      embedding,
      updated_at: safeString(row.updated_at)
    });
  }

  return map;
}

export async function getRecommendationCandidates(limit = 250): Promise<RecommendationCandidate[]> {
  if (!hasDatabaseUrl()) {
    return [];
  }

  const boundedLimit = Math.max(1, Math.min(limit, 500));
  const rows = await listAggregatedReviewRows();

  rows.sort((left, right) => {
    if (right.review.review_count !== left.review.review_count) {
      return right.review.review_count - left.review.review_count;
    }
    if (right.review.validated_tool_uses !== left.review.validated_tool_uses) {
      return right.review.validated_tool_uses - left.review.validated_tool_uses;
    }
    return left.review.server_slug.localeCompare(right.review.server_slug);
  });

  return rows.slice(0, boundedLimit).map((row) => ({
    server_slug: row.review.server_slug,
    tool_name: row.review.tool_name,
    category: row.review.category,
    review_count: row.review.review_count,
    recommended_count: row.recommended_count,
    caution_count: row.caution_count,
    avoid_count: row.avoid_count,
    validated_tool_uses: row.review.validated_tool_uses,
    total_usage_count: row.total_usage_count,
    last_submitted_utc: row.review.last_contribution_utc,
    source_text: row.source_text
  }));
}

export async function storeReviewSubmission(submission: ReviewSubmission): Promise<{
  reviewId: string;
  validatedToolUseCount: number;
  duplicate: boolean;
}> {
  const hasMeaningfulToolSignals =
    (Array.isArray(submission.reliable_tools) && submission.reliable_tools.length > 0)
    || (Array.isArray(submission.unreliable_tools) && submission.unreliable_tools.length > 0)
    || (Array.isArray(submission.hallucinated_tools) && submission.hallucinated_tools.length > 0)
    || (Array.isArray(submission.never_used_tools) && submission.never_used_tools.length > 0);

  if (!hasDatabaseUrl()) {
    if (submission.install_id) {
      const existing = fallbackInstalls.get(submission.install_id);
      if (existing) {
        if (!existing.any_submission_at) {
          existing.any_submission_at = new Date().toISOString();
        }
        if (hasMeaningfulToolSignals && !existing.first_submission_at) {
          existing.first_submission_at = new Date().toISOString();
        }
        fallbackInstalls.set(submission.install_id, existing);
      }
    }

    return {
      reviewId: `rev_${randomUUID()}`,
      validatedToolUseCount: submission.evidence.length,
      duplicate: false
    };
  }

  await ensureDbReady();

  const reviewId = `rev_${randomUUID()}`;
  const validatedToolUseCount = submission.evidence.length;
  const totalUsageCount = typeof submission.total_usage_count === "number" ? submission.total_usage_count : 0;

  const inserted = await getPool().query<SubmissionInsertRow>(
    `
      INSERT INTO review_submissions (
        review_id,
        server_slug,
        agent_model,
        install_id,
        idempotency_key,
        validated_tool_use_count,
        total_usage_count,
        status,
        submission_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8::jsonb)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING review_id, validated_tool_use_count
    `,
    [
      reviewId,
      submission.server_slug,
      submission.agent_model,
      submission.install_id ?? null,
      submission.idempotency_key,
      validatedToolUseCount,
      totalUsageCount,
      JSON.stringify(submission)
    ]
  );

  if (submission.install_id && hasMeaningfulToolSignals) {
    await getPool().query(
      `
        UPDATE tool_installs
        SET first_submission_at = COALESCE(first_submission_at, NOW())
        WHERE install_id = $1 AND revoked_at IS NULL
      `,
      [submission.install_id]
    );
  }

  if (hasMeaningfulToolSignals) {
    try {
      await upsertServerEmbedding(submission.server_slug, buildEmbeddingSourceText(submission));
    } catch {
      // Recommendation embeddings are best-effort and should not block submissions.
    }
  }

  if (inserted.rows[0]) {
    return {
      reviewId: inserted.rows[0].review_id,
      validatedToolUseCount: inserted.rows[0].validated_tool_use_count,
      duplicate: false
    };
  }

  const existing = await getPool().query<SubmissionInsertRow>(
    "SELECT review_id, validated_tool_use_count FROM review_submissions WHERE idempotency_key = $1 LIMIT 1",
    [submission.idempotency_key]
  );

  if (!existing.rows[0]) {
    return {
      reviewId,
      validatedToolUseCount,
      duplicate: true
    };
  }

  return {
    reviewId: existing.rows[0].review_id,
    validatedToolUseCount: existing.rows[0].validated_tool_use_count,
    duplicate: true
  };
}

export async function createInstallRecord() {
  const installId = `ins_${randomUUID()}`;
  const installSecret = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

  if (!hasDatabaseUrl()) {
    fallbackInstalls.set(installId, {
      install_secret: installSecret,
      any_submission_at: null,
      first_submission_at: null,
      revoked_at: null
    });
    return {
      installId,
      installSecret,
      secretVersion: 1
    };
  }

  await ensureDbReady();
  await getPool().query(
    `
      INSERT INTO tool_installs (install_id, install_secret, secret_version)
      VALUES ($1, $2, 1)
    `,
    [installId, installSecret]
  );

  return {
    installId,
    installSecret,
    secretVersion: 1
  };
}

export async function revokeInstallRecord(installId: string) {
  if (!hasDatabaseUrl()) {
    const current = fallbackInstalls.get(installId);
    if (current) {
      current.revoked_at = new Date().toISOString();
      fallbackInstalls.set(installId, current);
    }
    return { revoked: !!current };
  }

  await ensureDbReady();
  const result = await getPool().query(
    `
      UPDATE tool_installs
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE install_id = $1
    `,
    [installId]
  );
  return { revoked: (result.rowCount ?? 0) > 0 };
}

export async function getInstallStatus(installId: string) {
  if (!hasDatabaseUrl()) {
    const install = fallbackInstalls.get(installId);
    if (!install) {
      return {
        found: false,
        revoked: false,
        hasAnySubmission: false,
        firstSubmissionCompleted: false,
        firstSubmissionAt: null as string | null
      };
    }

    return {
      found: true,
      revoked: !!install.revoked_at,
      hasAnySubmission: !!install.any_submission_at,
      firstSubmissionCompleted: !!install.first_submission_at,
      firstSubmissionAt: install.first_submission_at
    };
  }

  await ensureDbReady();
  const rowResult = await getPool().query<InstallStatusRow>(
    `
      SELECT install_id, revoked_at::text
      FROM tool_installs
      WHERE install_id = $1
      LIMIT 1
    `,
    [installId]
  );

  const row = rowResult.rows[0];
  if (!row) {
    return {
      found: false,
      revoked: false,
      hasAnySubmission: false,
      firstSubmissionCompleted: false,
      firstSubmissionAt: null as string | null
    };
  }

  const submissionResult = await getPool().query<InstallSubmissionStatusRow>(
    `
      SELECT
        MIN(submitted_at)::text AS first_any_submission_at,
        MIN(
          CASE
            WHEN (
              (jsonb_typeof(submission_json->'reliable_tools') = 'array'
                AND jsonb_array_length(submission_json->'reliable_tools') > 0)
              OR (jsonb_typeof(submission_json->'unreliable_tools') = 'array'
                AND jsonb_array_length(submission_json->'unreliable_tools') > 0)
              OR (jsonb_typeof(submission_json->'hallucinated_tools') = 'array'
                AND jsonb_array_length(submission_json->'hallucinated_tools') > 0)
              OR (jsonb_typeof(submission_json->'never_used_tools') = 'array'
                AND jsonb_array_length(submission_json->'never_used_tools') > 0)
            )
            THEN submitted_at
            ELSE NULL
          END
        )::text AS first_meaningful_submission_at
      FROM review_submissions
      WHERE install_id = $1
    `,
    [installId]
  );
  const submissionRow = submissionResult.rows[0];

  return {
    found: true,
    revoked: !!row.revoked_at,
    hasAnySubmission: !!submissionRow?.first_any_submission_at,
    firstSubmissionCompleted: !!submissionRow?.first_meaningful_submission_at,
    firstSubmissionAt: submissionRow?.first_meaningful_submission_at ?? null
  };
}

export async function reseedReviewsForDb(): Promise<{
  removedGroundeffect: boolean;
  upserted: number;
}> {
  if (!hasDatabaseUrl()) {
    return {
      removedGroundeffect: false,
      upserted: 0
    };
  }

  await ensureDbReady();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const removedGroundeffect = (await client.query(
      "DELETE FROM tool_metadata WHERE server_slug = 'groundeffect'"
    )).rowCount !== 0;
    const upserted = await bootstrapSyntheticMetadata(client);

    await client.query("COMMIT");
    return {
      removedGroundeffect,
      upserted
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
