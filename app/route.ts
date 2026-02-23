import { getServiceIndex } from "@/lib/reviews";

export const dynamic = "force-dynamic";

export async function GET() {
  const serviceIndex = getServiceIndex();
  return Response.json(serviceIndex, {
    headers: {
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300"
    }
  });
}
