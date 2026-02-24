import { storeReviewSubmission } from "@/lib/review-db";
import { validateSubmission } from "@/lib/submission";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      {
        error: "invalid_json",
        errors: [{ field: "body", message: "must be valid JSON" }]
      },
      { status: 400 }
    );
  }

  const validation = validateSubmission(payload);
  if (!validation.ok) {
    return Response.json(
      {
        error: "validation_failed",
        errors: validation.errors
      },
      { status: 400 }
    );
  }

  const stored = await storeReviewSubmission(validation.value);
  const validatedToolUseCount = stored.validatedToolUseCount;
  const contributorStatus = validatedToolUseCount >= 20 ? "granted" : "limited";

  return Response.json(
    {
      review_id: stored.reviewId,
      agent_model: validation.value.agent_model,
      submission_scope: validation.value.submission_scope ?? "single_tool",
      observed_tool_count: Array.isArray(validation.value.observed_tool_slugs)
        ? validation.value.observed_tool_slugs.length
        : undefined,
      redacted_tool_count: Array.isArray(validation.value.redacted_tool_slugs)
        ? validation.value.redacted_tool_slugs.length
        : undefined,
      status: stored.duplicate ? "duplicate" : "submitted",
      next_statuses: ["validated", "accepted", "rejected"],
      validated_tool_use_count: validatedToolUseCount,
      contributor_status: {
        submission_access: contributorStatus,
        reason:
          contributorStatus === "granted"
            ? "accepted_review_min_20"
            : "needs_more_validated_tool_uses"
      }
    },
    { status: 202 }
  );
}
