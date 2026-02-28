import { getInstallStatus } from "@/lib/review-db";

function getInstallIdFromRequest(request: Request) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("install_id");
  if (fromQuery && fromQuery.trim().length > 0) {
    return fromQuery.trim();
  }

  const fromHeader = request.headers.get("x-toolspec-install-id");
  if (fromHeader && fromHeader.trim().length > 0) {
    return fromHeader.trim();
  }

  return null;
}

export async function GET(request: Request) {
  const installId = getInstallIdFromRequest(request);
  if (!installId) {
    return Response.json({
      submission_access: "limited",
      deny_reason: "install_id_missing",
      next_actions: ["run: toolspec verify", "run: toolspec review"],
      post_install_required: true,
      post_install_required_command: "toolspec review",
      post_install_required_message:
        "ToolSpec is installed, but this install is not activated yet. Run `toolspec review` to preview and confirm your first submission.",
      cooldown_seconds: 0
    });
  }

  const status = await getInstallStatus(installId);

  if (!status.found) {
    return Response.json(
      {
        submission_access: "denied",
        deny_reason: "install_not_found",
        next_actions: ["run: toolspec install", "run: toolspec verify"],
        post_install_required: true,
        post_install_required_command: "toolspec install",
        post_install_required_message:
          "This ToolSpec install ID was not found. Re-run `toolspec install` to re-register.",
        cooldown_seconds: 0
      },
      { status: 404 }
    );
  }

  if (status.revoked) {
    return Response.json(
      {
        submission_access: "denied",
        deny_reason: "install_revoked",
        next_actions: ["run: toolspec install", "run: toolspec verify"],
        post_install_required: true,
        post_install_required_command: "toolspec install",
        post_install_required_message:
          "This ToolSpec install was revoked. Re-run `toolspec install` to re-enable submissions.",
        cooldown_seconds: 0
      },
      { status: 403 }
    );
  }

  if (!status.firstSubmissionCompleted) {
    if (status.hasAnySubmission) {
      return Response.json({
        submission_access: "limited",
        deny_reason: "meaningful_submission_required",
        next_actions: [
          "use your tools in a real session",
          "run: toolspec review"
        ],
        post_install_required: true,
        post_install_required_command: "toolspec review",
        post_install_required_message:
          "Search is still locked for this install. Run `toolspec review` after a real session and confirm submission to unlock review reads.",
        cooldown_seconds: 0
      });
    }

    return Response.json({
      submission_access: "limited",
      deny_reason: "initial_submission_required",
      next_actions: ["run: toolspec review"],
      post_install_required: true,
      post_install_required_command: "toolspec review",
      post_install_required_message:
        "One last setup step: run `toolspec review`. It previews your submission and asks for confirmation.",
      cooldown_seconds: 0
    });
  }

  return Response.json({
    submission_access: "granted",
    deny_reason: null,
    next_actions: [],
    post_install_required: false,
    post_install_required_command: null,
    post_install_required_message:
      "ToolSpec is active for this install. Future `toolspec review` runs are optional and help keep reviews fresh.",
    first_submission_completed_at: status.firstSubmissionAt,
    cooldown_seconds: 0
  });
}
