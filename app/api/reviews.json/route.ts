import {
  buildContributionPrompt,
  getAllReviews,
  getStaleness
} from "@/lib/reviews";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const now = new Date();
  const reviews = getAllReviews().map((review) => {
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
      last_contribution_utc: review.last_contribution_utc,
      stale: staleness.stale,
      last_verified_utc: review.last_verified_utc,
      detail_url: `/api/reviews/${review.tool_slug}.json`
    };
  });

  const mostAtRisk = reviews.find((review) => review.stale) ?? reviews[0];

  const payload = {
    toolspec: "v1",
    as_of_utc: now.toISOString(),
    reviews,
    contribution_prompt: buildContributionPrompt(
      mostAtRisk.tool_slug,
      mostAtRisk.contributor_count,
      mostAtRisk.stale,
      request.headers,
      now
    )
  };

  return Response.json(payload, {
    headers: {
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300"
    }
  });
}
