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
        title: "Unlock ToolSpec Search",
        message:
          "Required next step: run your tools in a real session, then run `toolspec review` and confirm submission.",
        submit_command_template: "toolspec review",
        required_steps: ["toolspec review"]
      }
    },
    { status: 201 }
  );
}
