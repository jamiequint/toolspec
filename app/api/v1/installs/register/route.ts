import { createInstallRecord } from "@/lib/review-db";

export async function POST() {
  const created = await createInstallRecord();

  return Response.json(
    {
      install_id: created.installId,
      install_secret: created.installSecret,
      secret_version: created.secretVersion,
      post_install_prompt: {
        show: true,
        title: "Activate ToolSpec",
        message:
          "Required next step: run `toolspec approve`. It prepares a local draft if needed, then submits it.",
        submit_command_template: "toolspec approve",
        required_steps: ["toolspec approve"]
      }
    },
    { status: 201 }
  );
}
