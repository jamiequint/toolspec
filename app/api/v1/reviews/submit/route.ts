import crypto from "node:crypto";
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

  const validatedToolUseCount = validation.value.evidence.length;
  const contributorStatus = validatedToolUseCount >= 20 ? "granted" : "limited";

  return Response.json(
    {
      review_id: `rev_${crypto.randomUUID()}`,
      status: "submitted",
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
