import { reseedReviewsForDb } from "@/lib/review-db";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const token = process.env.TOOLSPEC_ADMIN_TOKEN;
  if (!token) {
    return false;
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${token}`;
  return authHeader === expected;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await reseedReviewsForDb();
  return Response.json({
    status: "ok",
    removed_groundeffect: result.removedGroundeffect,
    upserted_seed_reviews: result.upserted
  });
}
