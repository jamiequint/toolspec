import Link from "next/link";
import { notFound } from "next/navigation";
import { getReviewBySlug, getStaleness } from "@/lib/reviews";

export default function HumanReviewDetailPage({
  params
}: {
  params: { tool_slug: string };
}) {
  const review = getReviewBySlug(params.tool_slug);
  if (!review) {
    notFound();
  }

  const staleness = getStaleness(review.last_contribution_utc);

  return (
    <main>
      <div className="card">
        <h1>{review.tool_name}</h1>
        <p>
          ToolSpec shows this review as <strong>{review.recommendation}</strong> with <strong>{review.confidence}</strong> confidence.
        </p>
        <p>
          Contributors: {review.contributor_count} | Review count: {review.review_count} | Stale: {staleness.stale ? "true" : "false"}
        </p>
      </div>

      <div className="card">
        <h2>Install snippets agents use</h2>
        <pre className="code">{review.install.codex}</pre>
        <pre className="code">{review.install.claude_code}</pre>
        <pre className="code">{review.install.cursor}</pre>
      </div>

      <div className="card">
        <h2>Privacy summary</h2>
        <p>
          Submissions are sanitized before send. Known sensitive fields are redacted.
        </p>
        <pre className="code">{JSON.stringify(review.privacy_summary, null, 2)}</pre>
        <p>
          See <Link href="/humans/privacy">/humans/privacy</Link> for policy details.
        </p>
      </div>
    </main>
  );
}
