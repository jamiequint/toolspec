import {
  type Confidence,
  type FailureFrequency,
  type Recommendation
} from "@/lib/reviews";

const RECOMMENDATIONS: Recommendation[] = ["recommended", "caution", "avoid"];
const CONFIDENCE_LEVELS: Confidence[] = ["high", "medium", "low"];
const FAILURE_FREQUENCIES: FailureFrequency[] = ["rare", "occasional", "frequent", "persistent"];

export interface ValidationError {
  field: string;
  message: string;
}

export interface ReviewSubmission {
  install_id?: string;
  submission_scope?: "single_tool" | "all_observed";
  observed_tool_slugs?: string[];
  redacted_tool_slugs?: string[];
  tool_slug: string;
  agent_model: string;
  review_window_start_utc: string;
  review_window_end_utc: string;
  recommendation: Recommendation;
  confidence: Confidence;
  reliable_tools: string[];
  unreliable_tools: string[];
  hallucinated_tools: string[];
  never_used_tools: string[];
  behavioral_notes: string[];
  failure_modes: Array<{
    symptom: string;
    likely_cause: string;
    recovery: string;
    frequency: FailureFrequency;
  }>;
  evidence: Array<{
    tool_call_id: string;
    timestamp_utc: string;
  }>;
  idempotency_key: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateSubmission(body: unknown): {
  ok: true;
  value: ReviewSubmission;
} | {
  ok: false;
  errors: ValidationError[];
} {
  const errors: ValidationError[] = [];
  if (!isObject(body)) {
    return {
      ok: false,
      errors: [{ field: "body", message: "must be a JSON object" }]
    };
  }

  const agentModel = body.agent_model;
  if (typeof agentModel !== "string" || agentModel.length === 0) {
    errors.push({ field: "agent_model", message: "must be a non-empty string" });
  } else if (agentModel.length > 100) {
    errors.push({ field: "agent_model", message: "must be at most 100 characters" });
  } else if (!/^[a-zA-Z0-9._-]+$/.test(agentModel)) {
    errors.push({ field: "agent_model", message: "must match ^[a-zA-Z0-9._-]+$" });
  }

  const recommendation = body.recommendation;
  if (!RECOMMENDATIONS.includes(recommendation as Recommendation)) {
    errors.push({
      field: "recommendation",
      message: "must be one of recommended|caution|avoid"
    });
  }

  const confidence = body.confidence;
  if (!CONFIDENCE_LEVELS.includes(confidence as Confidence)) {
    errors.push({
      field: "confidence",
      message: "must be one of high|medium|low"
    });
  }

  const requiredStringFields = [
    "tool_slug",
    "review_window_start_utc",
    "review_window_end_utc",
    "idempotency_key"
  ] as const;

  for (const field of requiredStringFields) {
    if (typeof body[field] !== "string" || body[field].trim().length === 0) {
      errors.push({ field, message: "must be a non-empty string" });
    }
  }

  if (body.install_id !== undefined) {
    if (typeof body.install_id !== "string" || body.install_id.trim().length === 0) {
      errors.push({ field: "install_id", message: "must be a non-empty string when provided" });
    } else if (body.install_id.length > 100) {
      errors.push({ field: "install_id", message: "must be at most 100 characters" });
    } else if (!/^[a-zA-Z0-9._:-]+$/.test(body.install_id)) {
      errors.push({ field: "install_id", message: "contains invalid characters" });
    }
  }

  if (body.submission_scope !== undefined) {
    if (body.submission_scope !== "single_tool" && body.submission_scope !== "all_observed") {
      errors.push({
        field: "submission_scope",
        message: "must be one of single_tool|all_observed when provided"
      });
    }
  }

  if (body.observed_tool_slugs !== undefined && !isStringArray(body.observed_tool_slugs)) {
    errors.push({ field: "observed_tool_slugs", message: "must be an array of strings" });
  }

  if (body.redacted_tool_slugs !== undefined && !isStringArray(body.redacted_tool_slugs)) {
    errors.push({ field: "redacted_tool_slugs", message: "must be an array of strings" });
  }

  const listFields = [
    "reliable_tools",
    "unreliable_tools",
    "hallucinated_tools",
    "never_used_tools",
    "behavioral_notes"
  ] as const;

  for (const field of listFields) {
    if (!isStringArray(body[field])) {
      errors.push({ field, message: "must be an array of strings" });
    }
  }

  if (!Array.isArray(body.evidence)) {
    errors.push({ field: "evidence", message: "must be an array" });
  }

  if (!Array.isArray(body.failure_modes)) {
    errors.push({ field: "failure_modes", message: "must be an array" });
  } else {
    body.failure_modes.forEach((mode, index) => {
      if (!isObject(mode)) {
        errors.push({ field: `failure_modes[${index}]`, message: "must be an object" });
        return;
      }

      if (!FAILURE_FREQUENCIES.includes(mode.frequency as FailureFrequency)) {
        errors.push({
          field: `failure_modes[${index}].frequency`,
          message: "must be one of rare|occasional|frequent|persistent"
        });
      }

      const modeFields = ["symptom", "likely_cause", "recovery"] as const;
      for (const field of modeFields) {
        if (typeof mode[field] !== "string" || mode[field].trim().length === 0) {
          errors.push({
            field: `failure_modes[${index}].${field}`,
            message: "must be a non-empty string"
          });
        }
      }
    });
  }

  if (Array.isArray(body.evidence)) {
    body.evidence.forEach((entry, index) => {
      if (!isObject(entry)) {
        errors.push({ field: `evidence[${index}]`, message: "must be an object" });
        return;
      }

      if (typeof entry.tool_call_id !== "string" || entry.tool_call_id.trim().length === 0) {
        errors.push({
          field: `evidence[${index}].tool_call_id`,
          message: "must be a non-empty string"
        });
      }

      if (typeof entry.timestamp_utc !== "string" || entry.timestamp_utc.trim().length === 0) {
        errors.push({
          field: `evidence[${index}].timestamp_utc`,
          message: "must be a non-empty string"
        });
      }
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: body as unknown as ReviewSubmission };
}
