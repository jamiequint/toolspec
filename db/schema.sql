CREATE TABLE IF NOT EXISTS tool_metadata (
  server_slug TEXT PRIMARY KEY,
  metadata_json JSONB NOT NULL,
  is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_submissions (
  review_id TEXT PRIMARY KEY,
  server_slug TEXT NOT NULL,
  agent_model TEXT NOT NULL,
  install_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  validated_tool_use_count INTEGER NOT NULL,
  total_usage_count INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS server_embeddings (
  server_slug TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  source_text TEXT NOT NULL,
  embedding_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS review_submissions_server_slug_idx ON review_submissions (server_slug);
