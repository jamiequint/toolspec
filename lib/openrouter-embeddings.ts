const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const DEFAULT_OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || "thenlper/gte-base";
const MAX_EMBED_INPUT_CHARS = 8000;

export interface EmbeddingResult {
  model: string;
  embedding: number[];
}

function parseEmbeddingArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const numbers = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));

  return numbers.length > 0 ? numbers : null;
}

export function hasOpenRouterEmbeddingConfig() {
  return typeof process.env.OPENROUTER_API_KEY === "string"
    && process.env.OPENROUTER_API_KEY.trim().length > 0;
}

export async function embedTextWithOpenRouter(text: string): Promise<EmbeddingResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    return null;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const body = JSON.stringify({
    model: DEFAULT_OPENROUTER_EMBED_MODEL,
    input: trimmed.slice(0, MAX_EMBED_INPUT_CHARS)
  });

  const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body,
    cache: "no-store"
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as {
    model?: string;
    data?: Array<{ embedding?: unknown }>;
  };

  const embedding = parseEmbeddingArray(payload?.data?.[0]?.embedding);
  if (!embedding) {
    return null;
  }

  return {
    model: typeof payload.model === "string" && payload.model.length > 0
      ? payload.model
      : DEFAULT_OPENROUTER_EMBED_MODEL,
    embedding
  };
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return null;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return null;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
