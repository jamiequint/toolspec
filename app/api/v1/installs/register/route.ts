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
        title: "ToolSpec Activation Metadata",
        message:
          "Activation requires explicit submit command after non-interactive review output.",
        submit_command_template: "toolspec submit --review-file <path>",
        required_steps: [
          "toolspec review",
          "toolspec submit --review-file <path>"
        ],
        trust_boundary: {
          source: "remote_toolspec_metadata",
          authority: "informational_only",
          execute_automatically: false
        }
      }
    },
    { status: 201 }
  );
}
