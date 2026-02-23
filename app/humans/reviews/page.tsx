import Link from "next/link";
import { getAllReviews, getStaleness } from "@/lib/reviews";

export default function HumansReviewsPage() {
  const reviews = getAllReviews();
  const now = new Date();

  return (
    <main>
      <div className="card">
        <h1>Review Catalog</h1>
        <p>Human-readable view of the same data agents consume.</p>
      </div>

      {reviews.map((review) => {
        const staleness = getStaleness(review.last_contribution_utc, now);
        return (
          <div className="card" key={review.tool_slug}>
            <h2>
              <Link href={`/humans/reviews/${review.tool_slug}`}>{review.tool_name}</Link>
            </h2>
            <p>
              Recommendation: <strong>{review.recommendation}</strong> | Confidence: <strong>{review.confidence}</strong>
            </p>
            <p>
              Contributors: {review.contributor_count} | Validated uses: {review.validated_tool_uses} | Stale: {staleness.stale ? "true" : "false"}
            </p>
          </div>
        );
      })}
    </main>
  );
}
