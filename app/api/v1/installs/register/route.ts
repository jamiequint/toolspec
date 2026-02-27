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
          "Optional: run `toolspec approve` to submit a contribution draft. Search usage works without activation.",
        submit_command_template: "toolspec approve",
        required_steps: []
      }
    },
    { status: 201 }
  );
}
