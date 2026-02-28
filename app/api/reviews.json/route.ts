import {
  buildContributionPrompt,
  getStaleness
} from "@/lib/reviews";
import { getAllReviews, getInstallStatus } from "@/lib/review-db";

export const dynamic = "force-dynamic";

function getInstallIdFromRequest(request: Request) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("install_id");
  if (fromQuery && fromQuery.trim().length > 0) {
    return fromQuery.trim();
  }

  const fromHeader = request.headers.get("x-toolspec-install-id");
  if (fromHeader && fromHeader.trim().length > 0) {
    return fromHeader.trim();
  }

  return null;
}

export async function GET(request: Request) {
  const installId = getInstallIdFromRequest(request);
  if (!installId) {
    return Response.json(
      {
        error: "install_required",
        message:
          "ToolSpec review reads require an activated install. Run `toolspec install`, then submit observed tools with `toolspec submit`."
      },
      { status: 403 }
    );
  }

  const status = await getInstallStatus(installId);
  if (!status.found) {
    return Response.json(
      {
        error: "install_not_found",
        message: "Install ID not found. Re-run `toolspec install`."
      },
      { status: 403 }
    );
  }

  if (status.revoked) {
    return Response.json(
      {
        error: "install_revoked",
        message: "Install is revoked. Re-run `toolspec install`."
      },
      { status: 403 }
    );
  }

  if (!status.firstSubmissionCompleted) {
    const message = status.hasAnySubmission
      ? "Search is locked until this install submits observed tools. Run a real tool session, then `toolspec submit`."
      : "Install not activated for reads yet. Run `toolspec approve`, then use tools and run `toolspec submit`.";

    return Response.json(
      {
        error: "submission_required",
        message
      },
      { status: 403 }
    );
  }

  const now = new Date();
  const url = new URL(request.url);
  const agentFilter = url.searchParams.get("agent");

  const allReviews = await getAllReviews(agentFilter ?? undefined);

  const reviews = allReviews.map((review) => {
    const staleness = getStaleness(review.last_contribution_utc, now);
    return {
      tool_slug: review.tool_slug,
      tool_name: review.tool_name,
      category: review.category,
      recommendation: review.recommendation,
      confidence: review.confidence,
      calls_observed: review.calls_observed,
      sessions_observed: review.sessions_observed,
      error_rate: review.error_rate,
      connection_stability: review.connection_stability,
      setup_type: review.setup_type,
      review_count: review.review_count,
      contributor_count: review.contributor_count,
      validated_tool_uses: review.validated_tool_uses,
      agent_models: review.agent_models,
      last_contribution_utc: review.last_contribution_utc,
      stale: staleness.stale,
      last_verified_utc: review.last_verified_utc,
      detail_url: `/api/reviews/${review.tool_slug}.json`
    };
  });

  const mostAtRisk = reviews.find((review) => review.stale) ?? reviews[0];

  const payload: Record<string, unknown> = {
    toolspec: "v1",
    as_of_utc: now.toISOString(),
    reviews,
    contribution_prompt: mostAtRisk
      ? buildContributionPrompt(
          mostAtRisk.tool_slug,
          mostAtRisk.contributor_count,
          mostAtRisk.stale,
          request.headers,
          now
        )
      : null
  };

  if (agentFilter) {
    payload.agent_filter = agentFilter;
  }

  return Response.json(payload, {
    headers: {
      "cache-control": "private, no-store"
    }
  });
}
