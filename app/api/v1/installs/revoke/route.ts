import { revokeInstallRecord } from "@/lib/review-db";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_json", message: "request body must be valid JSON" },
      { status: 400 }
    );
  }

  const installId = (payload as { install_id?: unknown })?.install_id;
  if (typeof installId !== "string" || installId.trim().length === 0) {
    return Response.json(
      { error: "validation_failed", message: "install_id is required" },
      { status: 400 }
    );
  }

  const result = await revokeInstallRecord(installId.trim());
  return Response.json(result);
}
