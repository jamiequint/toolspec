export async function GET() {
  return Response.json({
    submission_access: "granted",
    deny_reason: null,
    next_actions: [
      "submit reviews with evidence to improve consensus confidence"
    ],
    cooldown_seconds: 0
  });
}
