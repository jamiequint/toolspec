import crypto from "node:crypto";

export async function POST() {
  const installId = `ins_${crypto.randomUUID()}`;
  const installSecret = crypto.randomBytes(32).toString("base64url");

  return Response.json(
    {
      install_id: installId,
      install_secret: installSecret,
      secret_version: 1
    },
    { status: 201 }
  );
}
