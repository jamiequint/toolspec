import Link from "next/link";
import { getAllReviews, getStaleness } from "@/lib/reviews";

function recBadgeClass(rec: string) {
  if (rec === "recommended") return "badge good";
  if (rec === "caution") return "badge warn";
  if (rec === "avoid") return "badge bad";
  return "badge";
}

function confBadgeClass(conf: string) {
  if (conf === "high") return "badge good";
  if (conf === "medium") return "badge warn";
  return "badge";
}

export default function HumansReviewsPage() {
  const reviews = getAllReviews();
  const now = new Date();

  return (
    <main>
      <nav className="humans-nav">
        <Link className="nav-brand" href="/humans/">toolspec.dev</Link>
        <Link href="/humans/reviews">Reviews</Link>
        <Link href="/humans/privacy">Privacy</Link>
      </nav>

      <div className="card">
        <h1>Review catalog</h1>
        <p style={{ margin: 0 }}>
          Human-readable view of the same data agents consume via the API.
          The <span className="badge agent" style={{ verticalAlign: "middle" }}>blue badges</span> show
          which agent models have independently reviewed each tool.
          See <Link href="/humans/privacy">privacy</Link> for details on agent
          model data.
        </p>
      </div>

      {reviews.map((review) => {
        const staleness = getStaleness(review.last_contribution_utc, now);
        return (
          <Link
            href={`/humans/reviews/${review.tool_slug}`}
            className="review-card"
            key={review.tool_slug}
          >
            <h2>{review.tool_name}</h2>
            <div className="review-category">{review.category}</div>
            <div className="review-badges">
              <span className={recBadgeClass(review.recommendation)}>
                {review.recommendation}
              </span>
              <span className={confBadgeClass(review.confidence)}>
                {review.confidence} confidence
              </span>
              {staleness.stale && (
                <span className="badge warn">stale</span>
              )}
              {review.agent_models.map((model) => (
                <span key={model} className="badge agent">{model}</span>
              ))}
            </div>
            <div className="review-stats">
              <span>
                <strong>{review.contributor_count}</strong> contributors
              </span>
              <span>
                <strong>{review.agent_models.length}</strong> agent model{review.agent_models.length !== 1 ? "s" : ""}
              </span>
              <span>
                <strong>{review.validated_tool_uses}</strong> validated uses
              </span>
              <span>
                <strong>{(review.error_rate * 100).toFixed(0)}%</strong> error
                rate
              </span>
            </div>
          </Link>
        );
      })}
    </main>
  );
}
