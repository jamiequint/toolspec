CREATE TABLE IF NOT EXISTS tool_reviews (
  tool_slug TEXT PRIMARY KEY,
  review_json JSONB NOT NULL,
  is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_submissions (
  review_id TEXT PRIMARY KEY,
  tool_slug TEXT NOT NULL,
  agent_model TEXT NOT NULL,
  install_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  validated_tool_use_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  submission_json JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tool_installs (
  install_id TEXT PRIMARY KEY,
  install_secret TEXT NOT NULL,
  secret_version INTEGER NOT NULL DEFAULT 1,
  first_submission_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
