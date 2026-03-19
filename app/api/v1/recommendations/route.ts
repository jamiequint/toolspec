import { cosineSimilarity, embedTextWithOpenRouter } from "@/lib/openrouter-embeddings";
import {
  getInstallStatus,
  getRecommendationCandidates,
  getServerEmbeddings,
  upsertServerEmbedding,
  type RecommendationCandidate
} from "@/lib/review-db";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function getInstallIdFromRequest(request: Request) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("install_id");
  if (fromQuery && fromQuery.trim().length > 0) {
    return fromQuery.trim();
  }

  const fromHeader = request.headers.get("x-toolspec-install-id");
  if (fromHeader && fromHeader.trim().length > 0) {
    return fromHeader.trim();
  }

  return null;
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function lexicalScore(query: string, candidate: RecommendationCandidate) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const candidateText = [
    candidate.server_slug,
    candidate.tool_name,
    candidate.category,
    candidate.source_text
  ]
    .join(" ")
    .toLowerCase();

  const matched = queryTokens.reduce((count, token) => (
    candidateText.includes(token) ? count + 1 : count
  ), 0);

  return matched / queryTokens.length;
}

function qualityScore(candidate: RecommendationCandidate, now: Date) {
  if (candidate.review_count <= 0) {
    return 0;
  }

  const recommendationScore = (
    candidate.recommended_count
    + (0.5 * candidate.caution_count)
  ) / candidate.review_count;

  const evidenceScore = Math.min(1, Math.log10(candidate.validated_tool_uses + 1) / 3);
  const usageScore = Math.min(1, Math.log10(candidate.total_usage_count + 1) / 4);

  let recencyScore = 0.5;
  if (candidate.last_submitted_utc) {
    const submitted = new Date(candidate.last_submitted_utc);
    if (!Number.isNaN(submitted.getTime())) {
      const ageDays = Math.max(0, (now.getTime() - submitted.getTime()) / DAY_MS);
      recencyScore = Math.exp(-ageDays / 90);
    }
  }

  return (0.55 * recommendationScore) + (0.2 * evidenceScore) + (0.1 * usageScore) + (0.15 * recencyScore);
}

function normalizeCosineScore(value: number | null) {
  if (value === null) {
    return null;
  }
  return (value + 1) / 2;
}

export async function GET(request: Request) {
  const installId = getInstallIdFromRequest(request);
  if (!installId) {
    return Response.json(
      {
        error: "install_required",
        message:
          "ToolSpec recommendations require an activated install. Run `toolspec install`, then submit an AI-reviewed JSON."
      },
      { status: 403 }
    );
  }

  const status = await getInstallStatus(installId);
  if (!status.found) {
    return Response.json(
      {
        error: "install_not_found",
        message: "Install ID not found. Re-run `toolspec install`."
      },
      { status: 403 }
    );
  }

  if (status.revoked) {
    return Response.json(
      {
        error: "install_revoked",
        message: "Install is revoked. Re-run `toolspec install`."
      },
      { status: 403 }
    );
  }

  if (!status.firstSubmissionCompleted) {
    return Response.json(
      {
        error: "submission_required",
        message:
          "Recommendations are available after contributing a meaningful review. Run `toolspec review`, then submit reviewed JSON."
      },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length === 0) {
    return Response.json(
      {
        error: "query_required",
        message: "Missing recommendation query. Usage: /api/v1/recommendations?q=<what_you_need>"
      },
      { status: 400 }
    );
  }

  const limitRaw = Number.parseInt(url.searchParams.get("limit") || "5", 10);
  const limit = Number.isNaN(limitRaw) ? 5 : Math.min(Math.max(limitRaw, 1), 20);

  const candidates = await getRecommendationCandidates(300);
  if (candidates.length === 0) {
    return Response.json({
      toolspec: "v1",
      query,
      mode: "hybrid_lexical",
      recommendations: []
    });
  }

  const candidateSlugs = candidates.map((candidate) => candidate.server_slug);
  let embeddingMap = await getServerEmbeddings(candidateSlugs);
  const queryEmbedding = await embedTextWithOpenRouter(query);

  if (queryEmbedding) {
    const missing = candidates
      .filter((candidate) => !embeddingMap.has(candidate.server_slug))
      .slice(0, 20);

    await Promise.all(missing.map(async (candidate) => {
      try {
        await upsertServerEmbedding(candidate.server_slug, candidate.source_text);
      } catch {
        // No-op: recommendation path should still return lexical-quality ranking.
      }
    }));

    if (missing.length > 0) {
      embeddingMap = await getServerEmbeddings(candidateSlugs);
    }
  }

  const now = new Date();
  const scored = candidates.map((candidate) => {
    const quality = qualityScore(candidate, now);
    const lexical = lexicalScore(query, candidate);

    const serverEmbedding = embeddingMap.get(candidate.server_slug);
    const cosine = queryEmbedding && serverEmbedding
      ? cosineSimilarity(queryEmbedding.embedding, serverEmbedding.embedding)
      : null;
    const vector = normalizeCosineScore(cosine);

    const finalScore = vector === null
      ? (0.65 * lexical) + (0.35 * quality)
      : (0.55 * vector) + (0.25 * quality) + (0.2 * lexical);

    const recommendedRatio = candidate.review_count > 0
      ? candidate.recommended_count / candidate.review_count
      : 0;

    const rationale = [
      `recommended_ratio=${recommendedRatio.toFixed(2)}`,
      `review_count=${candidate.review_count}`,
      `validated_uses=${candidate.validated_tool_uses}`
    ];

    if (vector !== null) {
      rationale.push(`semantic_match=${vector.toFixed(2)}`);
    }

    if (lexical > 0) {
      rationale.push(`keyword_match=${lexical.toFixed(2)}`);
    }

    return {
      server_slug: candidate.server_slug,
      tool_name: candidate.tool_name,
      category: candidate.category,
      score: Number(finalScore.toFixed(6)),
      detail_url: `/api/reviews/${candidate.server_slug}.json`,
      rationale,
      signals: {
        quality: Number(quality.toFixed(4)),
        lexical: Number(lexical.toFixed(4)),
        vector: vector === null ? null : Number(vector.toFixed(4)),
        review_count: candidate.review_count,
        recommended_ratio: Number(recommendedRatio.toFixed(4)),
        validated_tool_uses: candidate.validated_tool_uses,
        total_usage_count: candidate.total_usage_count
      }
    };
  });

  scored.sort((left, right) => right.score - left.score);

  return Response.json({
    toolspec: "v1",
    query,
    mode: queryEmbedding ? "hybrid_vector_lexical_quality" : "hybrid_lexical_quality",
    recommendations: scored.slice(0, limit)
  }, {
    headers: {
      "cache-control": "private, no-store"
    }
  });
}
