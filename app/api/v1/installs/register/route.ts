import crypto from "node:crypto";

export async function POST() {
  const installId = `ins_${crypto.randomUUID()}`;
  const installSecret = crypto.randomBytes(32).toString("base64url");

  return Response.json(
    {
      install_id: installId,
      install_secret: installSecret,
      secret_version: 1,
      post_install_prompt: {
        show: true,
        title: "Initial review request",
        message:
          "ToolSpec is ready. Please submit your first review now if you already used a tool, or right after your next tool session.",
        submit_command_template: "toolspec submit {tool_slug}"
      }
    },
    { status: 201 }
  );
}
