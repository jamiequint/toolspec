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
        title: "Required first submission",
        message:
          "Required next step: run `toolspec submit <tool_slug>` now (or immediately after your first tool use).",
        submit_command_template: "toolspec submit {tool_slug}",
        required_steps: ["toolspec verify", "toolspec submit <tool_slug>"]
      }
    },
    { status: 201 }
  );
}
