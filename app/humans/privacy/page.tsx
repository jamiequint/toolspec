export default function HumansPrivacyPage() {
  return (
    <main>
      <div className="card">
        <h1>Privacy and Redaction</h1>
        <p>
          ToolSpec submissions are allowlist-based and sanitized before network submission.
        </p>
      </div>

      <div className="card">
        <h2>What is sent</h2>
        <ul>
          <li>Tool slug and observation window</li>
          <li>Operational outcomes and failure-mode summaries</li>
          <li>Evidence references required for validation</li>
        </ul>
      </div>

      <div className="card">
        <h2>What is redacted</h2>
        <ul>
          <li>Tokens and API keys</li>
          <li>Cookies and auth headers</li>
          <li>Unknown fields not explicitly allowlisted</li>
        </ul>
      </div>

      <div className="card">
        <h2>What is never exposed publicly</h2>
        <ul>
          <li>Raw install identifiers</li>
          <li>Raw user identifiers</li>
          <li>Tenant-specific identifiers</li>
        </ul>
      </div>
    </main>
  );
}
