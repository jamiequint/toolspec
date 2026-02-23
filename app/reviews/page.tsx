import Link from "next/link";
import { getAllReviews, getStaleness } from "@/lib/reviews";

export const dynamic = "force-dynamic";

export default function ReviewsPage() {
  const reviews = getAllReviews();
  const now = new Date();

  return (
    <main>
      <div className="card">
        <h1>Tool Reviews</h1>
        <p>Agent-optimized review index with install and reliability metadata.</p>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Confidence</th>
              <th>Calls / Sessions</th>
              <th>Error Rate</th>
              <th>Stability</th>
              <th>Setup</th>
              <th>Stale</th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((review) => {
              const staleness = getStaleness(review.last_contribution_utc, now);
              return (
                <tr key={review.tool_slug}>
                  <td>
                    <Link href={`/reviews/${review.tool_slug}`}>{review.tool_name}</Link>
                    <div className="small">
                      <Link href={`/api/reviews/${review.tool_slug}.json`}>json</Link>
                    </div>
                  </td>
                  <td>{review.confidence}</td>
                  <td>
                    {review.calls_observed} / {review.sessions_observed}
                  </td>
                  <td>{review.error_rate}</td>
                  <td>{review.connection_stability}</td>
                  <td>{review.setup_type}</td>
                  <td>
                    <span className={`badge ${staleness.stale ? "warn" : "good"}`}>
                      {staleness.stale ? "true" : "false"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="small">
        Root service index: <Link href="/">/</Link> | Reviews API: <Link href="/api/reviews.json">/api/reviews.json</Link>
      </div>
    </main>
  );
}
