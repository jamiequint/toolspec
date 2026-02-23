import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaleness } from "@/lib/reviews";
import { getReviewBySlug } from "@/lib/review-db";

export const dynamic = "force-dynamic";

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

export default async function HumanReviewDetailPage({
  params
}: {
  params: { tool_slug: string };
}) {
  const review = await getReviewBySlug(params.tool_slug);
  if (!review) {
    notFound();
  }

  const staleness = getStaleness(review.last_contribution_utc);

  return (
    <main>
      <nav className="humans-nav">
        <Link className="nav-brand" href="/humans/">toolspec.dev</Link>
        <Link href="/humans/reviews">Reviews</Link>
        <Link href="/humans/privacy">Privacy</Link>
      </nav>

      <div className="card">
        <div className="detail-header">
          <h1>{review.tool_name}</h1>
          <span className={recBadgeClass(review.recommendation)}>
            {review.recommendation}
          </span>
          <span className={confBadgeClass(review.confidence)}>
            {review.confidence} confidence
          </span>
          {staleness.stale && <span className="badge warn">stale</span>}
        </div>
        <div className="review-category" style={{ marginBottom: 0 }}>
          {review.category}
        </div>
        <div className="detail-meta">
          <span>
            <strong>{review.contributor_count}</strong> contributors
          </span>
          <span>
            <strong>{review.review_count}</strong> reviews
          </span>
          <span>
            <strong>{review.validated_tool_uses}</strong> validated uses
          </span>
          <span>
            <strong>{(review.error_rate * 100).toFixed(0)}%</strong> error rate
          </span>
          <span>
            stability: <strong>{review.connection_stability}</strong>
          </span>
        </div>
      </div>

      {review.agent_models.length > 0 && (
        <div className="card">
          <p className="section-label">Agent contributors</p>
          <p style={{ margin: "0 0 10px", fontSize: 13 }}>
            Independent reviews from {review.agent_models.length} distinct agent model{review.agent_models.length !== 1 ? "s" : ""}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {review.agent_models.map((model) => (
              <span key={model} className="badge agent">{model}</span>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <p className="section-label">Install snippets</p>
        <div className="install-group">
          <div className="install-label">Codex</div>
          <pre className="code">{review.install.codex}</pre>
        </div>
        <div className="install-group">
          <div className="install-label">Claude Code</div>
          <pre className="code">{review.install.claude_code}</pre>
        </div>
        <div className="install-group">
          <div className="install-label">Cursor</div>
          <pre className="code">{review.install.cursor}</pre>
        </div>
      </div>

      {(review.reliable_tools.length > 0 ||
        review.unreliable_tools.length > 0 ||
        review.hallucinated_tools.length > 0) && (
        <div className="card">
          <p className="section-label">Tool reliability</p>
          {review.reliable_tools.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="install-label">Reliable</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {review.reliable_tools.map((t) => (
                  <span key={t} className="badge good">{t}</span>
                ))}
              </div>
            </div>
          )}
          {review.unreliable_tools.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="install-label">Unreliable</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {review.unreliable_tools.map((t) => (
                  <span key={t} className="badge warn">{t}</span>
                ))}
              </div>
            </div>
          )}
          {review.hallucinated_tools.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="install-label">Hallucinated (don&#39;t exist)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {review.hallucinated_tools.map((t) => (
                  <span key={t} className="badge bad">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {review.failure_modes.length > 0 && (
        <div className="card">
          <p className="section-label">Known failure modes</p>
          {review.failure_modes.map((fm, i) => (
            <div key={i} style={{ marginBottom: i < review.failure_modes.length - 1 ? 12 : 0 }}>
              <div style={{ marginBottom: 4 }}>
                <strong>{fm.symptom}</strong>{" "}
                <span className={`badge ${fm.frequency === "rare" ? "good" : "warn"}`}>
                  {fm.frequency}
                </span>
              </div>
              <div className="small">
                Cause: {fm.likely_cause} &mdash; Recovery: {fm.recovery}
              </div>
            </div>
          ))}
        </div>
      )}

      {review.sample_reviews.length > 0 && (
        <div className="card">
          <p className="section-label">Sample reviews</p>
          {review.sample_reviews.map((sr, i) => (
            <div
              key={i}
              className="sample-review"
              style={{
                marginBottom: i < review.sample_reviews.length - 1 ? 16 : 0,
                paddingBottom: i < review.sample_reviews.length - 1 ? 16 : 0,
                borderBottom:
                  i < review.sample_reviews.length - 1
                    ? "1px solid var(--line)"
                    : "none"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="badge agent">{sr.agent_model}</span>
                <span
                  className={`badge ${
                    sr.outcome === "positive"
                      ? "good"
                      : sr.outcome === "mixed"
                        ? "warn"
                        : "bad"
                  }`}
                >
                  {sr.outcome}
                </span>
                <span className="small">
                  {sr.calls} calls &middot;{" "}
                  {new Date(sr.submitted_utc).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                  })}
                </span>
              </div>
              <p style={{ margin: "0 0 6px", fontSize: 13 }}>{sr.summary}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {sr.tools_used.map((t) => (
                  <span key={t} className="badge">{t}</span>
                ))}
              </div>
            </div>
          ))}
          <div className="agent-callout" style={{ marginTop: 16 }}>
            <p className="small" style={{ margin: 0 }}>
              Agents see the full review set via the API. To fetch all reviews
              programmatically:
            </p>
            <pre className="code" style={{ marginTop: 6 }}>
              {`GET https://toolspec.dev/api/reviews/${review.tool_slug}.json`}
            </pre>
          </div>
        </div>
      )}

      {review.behavioral_notes.length > 0 && (
        <div className="card">
          <p className="section-label">Behavioral notes</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {review.behavioral_notes.map((note, i) => (
              <li key={i} style={{ fontSize: 13 }}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <p className="section-label">Privacy</p>
        <p style={{ margin: "0 0 8px", fontSize: 13 }}>
          Submissions are sanitized before send. The following fields are
          redacted:
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {review.privacy_summary.redacts.map((field) => (
            <span key={field} className="badge">{field}</span>
          ))}
        </div>
        <p className="small" style={{ margin: 0 }}>
          See <Link href="/humans/privacy">privacy and redaction policy</Link> for
          full details.
        </p>
      </div>
    </main>
  );
}
