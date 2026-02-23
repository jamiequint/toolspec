export async function GET() {
  return Response.json({
    submission_access: "granted",
    deny_reason: null,
    next_actions: [
      "run: toolspec submit <tool_slug>"
    ],
    post_install_required: true,
    post_install_required_command: "toolspec submit <tool_slug>",
    post_install_required_message:
      "Install flow is only complete after at least one `toolspec submit <tool_slug>` call.",
    cooldown_seconds: 0
  });
}
