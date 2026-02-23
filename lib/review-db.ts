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
          CREATE TABLE IF NOT EXISTS review_submissions (
            review_id TEXT PRIMARY KEY,
            tool_slug TEXT NOT NULL,
            agent_model TEXT NOT NULL,
            idempotency_key TEXT NOT NULL UNIQUE,
            validated_tool_use_count INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'submitted',
            submission_json JSONB NOT NULL,
            submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

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
  if (!hasDatabaseUrl()) {
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
        idempotency_key,
        validated_tool_use_count,
        status,
        submission_json
      )
      VALUES ($1, $2, $3, $4, $5, 'submitted', $6::jsonb)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING review_id, validated_tool_use_count
    `,
    [
      reviewId,
      submission.tool_slug,
      submission.agent_model,
      submission.idempotency_key,
      validatedToolUseCount,
      JSON.stringify(submission)
    ]
  );

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
