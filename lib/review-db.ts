import { randomUUID } from "node:crypto";
import { Pool, type QueryResultRow } from "pg";
import type { ReviewSubmission } from "@/lib/submission";
import type { ToolReview } from "@/lib/reviews";
import { REVIEW_SEED_DATA } from "@/lib/review-seed-data";

type ToolReviewRow = QueryResultRow & {
  tool_slug: string;
  review_json: ToolReview;
};

type SubmissionRow = QueryResultRow & {
  review_id: string;
  validated_tool_use_count: number;
};

type InstallStatusRow = QueryResultRow & {
  install_id: string;
  revoked_at: string | null;
};

type InstallSubmissionStatusRow = QueryResultRow & {
  first_any_submission_at: string | null;
  first_meaningful_submission_at: string | null;
};

const fallbackInstalls = new Map<string, {
  install_secret: string;
  any_submission_at: string | null;
  first_submission_at: string | null;
  revoked_at: string | null;
}>();

let pool: Pool | null = null;
let ensurePromise: Promise<void> | null = null;

function normalizeConnectionString(connectionString: string) {
  if (connectionString.includes("localhost") || connectionString.includes("127.0.0.1")) {
    return connectionString;
  }

  try {
    const url = new URL(connectionString);
    url.searchParams.set("sslmode", "no-verify");
    return url.toString();
  } catch {
    return connectionString;
  }
}

function hasDatabaseUrl() {
  return typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0;
}

function getPool() {
  if (!pool) {
    const rawConnectionString = process.env.DATABASE_URL;
    const connectionString = rawConnectionString ? normalizeConnectionString(rawConnectionString) : "";
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for DB-backed review store");
    }

    const ssl = connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false };
    pool = new Pool({
      connectionString,
      max: 4,
      ssl
    });
  }

  return pool;
}

async function ensureDbReady() {
  if (!hasDatabaseUrl()) {
    return;
  }

  if (!ensurePromise) {
    ensurePromise = (async () => {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");

        await client.query(`
          CREATE TABLE IF NOT EXISTS tool_reviews (
            tool_slug TEXT PRIMARY KEY,
            review_json JSONB NOT NULL,
            is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS tool_installs (
            install_id TEXT PRIMARY KEY,
            install_secret TEXT NOT NULL,
            secret_version INTEGER NOT NULL DEFAULT 1,
            first_submission_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await client.query(`
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
          )
        `);

        await client.query(
          "ALTER TABLE review_submissions ADD COLUMN IF NOT EXISTS install_id TEXT"
        );

        await client.query("DELETE FROM tool_reviews WHERE tool_slug = 'groundeffect'");

        const existingCountResult = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM tool_reviews"
        );
        const existingCount = Number.parseInt(existingCountResult.rows[0]?.count ?? "0", 10);

        if (existingCount === 0) {
          for (const review of REVIEW_SEED_DATA) {
            await client.query(
              `
                INSERT INTO tool_reviews (tool_slug, review_json, is_synthetic)
                VALUES ($1, $2::jsonb, TRUE)
              `,
              [review.tool_slug, JSON.stringify(review)]
            );
          }
        } else {
          for (const review of REVIEW_SEED_DATA) {
            await client.query(
              `
                INSERT INTO tool_reviews (tool_slug, review_json, is_synthetic, updated_at)
                VALUES ($1, $2::jsonb, TRUE, NOW())
                ON CONFLICT (tool_slug)
                DO UPDATE SET
                  review_json = EXCLUDED.review_json,
                  updated_at = NOW()
                WHERE tool_reviews.is_synthetic = TRUE
              `,
              [review.tool_slug, JSON.stringify(review)]
            );
          }
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })();
  }

  await ensurePromise;
}

export async function getAllReviews(agentFilter?: string): Promise<ToolReview[]> {
  if (!hasDatabaseUrl()) {
    if (!agentFilter) {
      return REVIEW_SEED_DATA;
    }
    return REVIEW_SEED_DATA.filter((review) => review.agent_models.includes(agentFilter));
  }

  await ensureDbReady();
  const rows = await getPool().query<ToolReviewRow>(
    "SELECT tool_slug, review_json FROM tool_reviews ORDER BY tool_slug ASC"
  );

  const all = rows.rows.map((row) => row.review_json);
  if (!agentFilter) {
    return all;
  }

  return all.filter((review) => review.agent_models.includes(agentFilter));
}

export async function getReviewBySlug(toolSlug: string): Promise<ToolReview | null> {
  if (!hasDatabaseUrl()) {
    return REVIEW_SEED_DATA.find((review) => review.tool_slug === toolSlug) ?? null;
  }

  await ensureDbReady();
  const rows = await getPool().query<ToolReviewRow>(
    "SELECT tool_slug, review_json FROM tool_reviews WHERE tool_slug = $1 LIMIT 1",
    [toolSlug]
  );

  return rows.rows[0]?.review_json ?? null;
}

export async function storeReviewSubmission(submission: ReviewSubmission): Promise<{
  reviewId: string;
  validatedToolUseCount: number;
  duplicate: boolean;
}> {
  const hasMeaningfulObservedTools = Array.isArray(submission.observed_tool_slugs)
    && submission.observed_tool_slugs.length > 0;

  if (!hasDatabaseUrl()) {
    if (submission.install_id) {
      const existing = fallbackInstalls.get(submission.install_id);
      if (existing) {
        if (!existing.any_submission_at) {
          existing.any_submission_at = new Date().toISOString();
        }
        if (hasMeaningfulObservedTools && !existing.first_submission_at) {
          existing.first_submission_at = new Date().toISOString();
        }
        fallbackInstalls.set(submission.install_id, existing);
      }
    }

    return {
      reviewId: `rev_${randomUUID()}`,
      validatedToolUseCount: submission.evidence.length,
      duplicate: false
    };
  }

  await ensureDbReady();

  const reviewId = `rev_${randomUUID()}`;
  const validatedToolUseCount = submission.evidence.length;

  const inserted = await getPool().query<SubmissionRow>(
    `
      INSERT INTO review_submissions (
        review_id,
        tool_slug,
        agent_model,
        install_id,
        idempotency_key,
        validated_tool_use_count,
        status,
        submission_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'submitted', $7::jsonb)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING review_id, validated_tool_use_count
    `,
    [
      reviewId,
      submission.tool_slug,
      submission.agent_model,
      submission.install_id ?? null,
      submission.idempotency_key,
      validatedToolUseCount,
      JSON.stringify(submission)
    ]
  );

  if (submission.install_id && hasMeaningfulObservedTools) {
    await getPool().query(
      `
        UPDATE tool_installs
        SET first_submission_at = COALESCE(first_submission_at, NOW())
        WHERE install_id = $1 AND revoked_at IS NULL
      `,
      [submission.install_id]
    );
  }

  if (inserted.rows[0]) {
    return {
      reviewId: inserted.rows[0].review_id,
      validatedToolUseCount: inserted.rows[0].validated_tool_use_count,
      duplicate: false
    };
  }

  const existing = await getPool().query<SubmissionRow>(
    "SELECT review_id, validated_tool_use_count FROM review_submissions WHERE idempotency_key = $1 LIMIT 1",
    [submission.idempotency_key]
  );

  if (!existing.rows[0]) {
    return {
      reviewId,
      validatedToolUseCount,
      duplicate: true
    };
  }

  return {
    reviewId: existing.rows[0].review_id,
    validatedToolUseCount: existing.rows[0].validated_tool_use_count,
    duplicate: true
  };
}

export async function createInstallRecord() {
  const installId = `ins_${randomUUID()}`;
  const installSecret = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

  if (!hasDatabaseUrl()) {
    fallbackInstalls.set(installId, {
      install_secret: installSecret,
      any_submission_at: null,
      first_submission_at: null,
      revoked_at: null
    });
    return {
      installId,
      installSecret,
      secretVersion: 1
    };
  }

  await ensureDbReady();
  await getPool().query(
    `
      INSERT INTO tool_installs (install_id, install_secret, secret_version)
      VALUES ($1, $2, 1)
    `,
    [installId, installSecret]
  );

  return {
    installId,
    installSecret,
    secretVersion: 1
  };
}

export async function revokeInstallRecord(installId: string) {
  if (!hasDatabaseUrl()) {
    const current = fallbackInstalls.get(installId);
    if (current) {
      current.revoked_at = new Date().toISOString();
      fallbackInstalls.set(installId, current);
    }
    return { revoked: !!current };
  }

  await ensureDbReady();
  const result = await getPool().query(
    `
      UPDATE tool_installs
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE install_id = $1
    `,
    [installId]
  );
  return { revoked: (result.rowCount ?? 0) > 0 };
}

export async function getInstallStatus(installId: string) {
  if (!hasDatabaseUrl()) {
    const install = fallbackInstalls.get(installId);
    if (!install) {
      return {
        found: false,
        revoked: false,
        hasAnySubmission: false,
        firstSubmissionCompleted: false,
        firstSubmissionAt: null as string | null
      };
    }

    return {
      found: true,
      revoked: !!install.revoked_at,
      hasAnySubmission: !!install.any_submission_at,
      firstSubmissionCompleted: !!install.first_submission_at,
      firstSubmissionAt: install.first_submission_at
    };
  }

  await ensureDbReady();
  const rowResult = await getPool().query<InstallStatusRow>(
    `
      SELECT install_id, revoked_at::text
      FROM tool_installs
      WHERE install_id = $1
      LIMIT 1
    `,
    [installId]
  );

  const row = rowResult.rows[0];
  if (!row) {
    return {
      found: false,
      revoked: false,
      hasAnySubmission: false,
      firstSubmissionCompleted: false,
      firstSubmissionAt: null as string | null
    };
  }

  const submissionResult = await getPool().query<InstallSubmissionStatusRow>(
    `
      SELECT
        MIN(submitted_at)::text AS first_any_submission_at,
        MIN(
          CASE
            WHEN jsonb_typeof(submission_json->'observed_tool_slugs') = 'array'
              AND jsonb_array_length(submission_json->'observed_tool_slugs') > 0
            THEN submitted_at
            ELSE NULL
          END
        )::text AS first_meaningful_submission_at
      FROM review_submissions
      WHERE install_id = $1
    `,
    [installId]
  );
  const submissionRow = submissionResult.rows[0];

  return {
    found: true,
    revoked: !!row.revoked_at,
    hasAnySubmission: !!submissionRow?.first_any_submission_at,
    firstSubmissionCompleted: !!submissionRow?.first_meaningful_submission_at,
    firstSubmissionAt: submissionRow?.first_meaningful_submission_at ?? null
  };
}

export async function reseedReviewsForDb(): Promise<{
  removedGroundeffect: boolean;
  upserted: number;
}> {
  if (!hasDatabaseUrl()) {
    return {
      removedGroundeffect: true,
      upserted: REVIEW_SEED_DATA.length
    };
  }

  await ensureDbReady();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM tool_reviews WHERE tool_slug = 'groundeffect'");

    for (const review of REVIEW_SEED_DATA) {
      await client.query(
        `
          INSERT INTO tool_reviews (tool_slug, review_json, is_synthetic, updated_at)
          VALUES ($1, $2::jsonb, TRUE, NOW())
          ON CONFLICT (tool_slug)
          DO UPDATE SET
            review_json = EXCLUDED.review_json,
            updated_at = NOW()
          WHERE tool_reviews.is_synthetic = TRUE
        `,
        [review.tool_slug, JSON.stringify(review)]
      );
    }

    await client.query("COMMIT");
    return {
      removedGroundeffect: true,
      upserted: REVIEW_SEED_DATA.length
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
