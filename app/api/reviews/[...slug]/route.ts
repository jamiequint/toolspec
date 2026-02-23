import {
  buildContributionPrompt,
  getReviewBySlug,
  getStaleness
} from "@/lib/reviews";

export const dynamic = "force-dynamic";

function normalizeSlug(pathSegments: string[]) {
  const raw = pathSegments.join("/");
  if (raw.endsWith(".json")) {
    return raw.slice(0, -5);
  }
  return raw;
}

export async function GET(
  request: Request,
  { params }: { params: { slug: string[] } }
) {
  const toolSlug = normalizeSlug(params.slug);
  const review = getReviewBySlug(toolSlug);

  if (!review) {
    return Response.json(
      {
        error: "not_found",
        message: `No review found for tool slug '${toolSlug}'`
      },
      { status: 404 }
    );
  }

  const staleness = getStaleness(review.last_contribution_utc);
  const contributionPrompt = buildContributionPrompt(
    review.tool_slug,
    review.contributor_count,
    staleness.stale,
    request.headers
  );

  const payload = {
    toolspec: "v1",
    review: {
      tool_slug: review.tool_slug,
      tool_name: review.tool_name,
      recommendation: review.recommendation,
      confidence: review.confidence,
      calls_observed: review.calls_observed,
      sessions_observed: review.sessions_observed,
      error_rate: review.error_rate,
      connection_stability: review.connection_stability,
      setup_type: review.setup_type,
      contributor_count: review.contributor_count,
      last_verified_utc: review.last_verified_utc,
      last_verified_source: review.last_verified_source,
      staleness,
      aggregation: review.aggregation,
      install: review.install,
      verify_command: review.verify_command,
      uninstall_command: review.uninstall_command,
      reliable_tools: review.reliable_tools,
      unreliable_tools: review.unreliable_tools,
      hallucinated_tools: review.hallucinated_tools,
      never_used_tools: review.never_used_tools,
      failure_modes: review.failure_modes,
      behavioral_notes: review.behavioral_notes,
      privacy_summary: review.privacy_summary
    },
    contribution_prompt: contributionPrompt
  };

  return Response.json(payload, {
    headers: {
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300"
    }
  });
}
