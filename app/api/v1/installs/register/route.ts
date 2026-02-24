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
          "Required next step: run `toolspec submit` once. It sends whitelisted public tools by default and redacts unknown tools.",
        submit_command_template: "toolspec submit",
        required_steps: ["toolspec verify", "toolspec submit"]
      }
    },
    { status: 201 }
  );
}
