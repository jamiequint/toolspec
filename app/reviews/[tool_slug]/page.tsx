import Link from "next/link";
import { notFound } from "next/navigation";
import { getReviewBySlug, getStaleness } from "@/lib/reviews";

export const dynamic = "force-dynamic";

export default function ReviewDetailPage({
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
          <span className="badge">{review.recommendation}</span> <span className="badge">{review.confidence}</span>
        </p>
        <dl className="kv">
          <dt>Calls / Sessions</dt>
          <dd>
            {review.calls_observed} / {review.sessions_observed}
          </dd>
          <dt>Error Rate</dt>
          <dd>{review.error_rate}</dd>
          <dt>Connection Stability</dt>
          <dd>{review.connection_stability}</dd>
          <dt>Setup Type</dt>
          <dd>{review.setup_type}</dd>
          <dt>Contributors</dt>
          <dd>{review.contributor_count}</dd>
          <dt>Validated Uses</dt>
          <dd>{review.validated_tool_uses}</dd>
          <dt>Last Contribution</dt>
          <dd>{review.last_contribution_utc}</dd>
          <dt>Stale</dt>
          <dd>{staleness.stale ? "true" : "false"}</dd>
          <dt>Last Verified</dt>
          <dd>
            {review.last_verified_utc} ({review.last_verified_source})
          </dd>
        </dl>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Install</h2>
          <h3>Codex</h3>
          <pre className="code">{review.install.codex}</pre>
          <h3>Claude Code</h3>
          <pre className="code">{review.install.claude_code}</pre>
          <h3>Cursor</h3>
          <pre className="code">{review.install.cursor}</pre>
        </div>

        <div className="card">
          <h2>Operational Notes</h2>
          <h3>Reliable Tools</h3>
          <pre className="code">{JSON.stringify(review.reliable_tools, null, 2)}</pre>
          <h3>Unreliable Tools</h3>
          <pre className="code">{JSON.stringify(review.unreliable_tools, null, 2)}</pre>
          <h3>Hallucinated Tools</h3>
          <pre className="code">{JSON.stringify(review.hallucinated_tools, null, 2)}</pre>
          <h3>Never Used Tools</h3>
          <pre className="code">{JSON.stringify(review.never_used_tools, null, 2)}</pre>
        </div>
      </div>

      <div className="card">
        <h2>Failure Modes</h2>
        <pre className="code">{JSON.stringify(review.failure_modes, null, 2)}</pre>
        <h2>Behavioral Notes</h2>
        <pre className="code">{JSON.stringify(review.behavioral_notes, null, 2)}</pre>
      </div>

      <div className="small">
        Detail JSON: <Link href={`/api/reviews/${review.tool_slug}.json`}>{`/api/reviews/${review.tool_slug}.json`}</Link>
      </div>
    </main>
  );
}
