export async function POST() {
  return Response.json({
    referral_registered: true,
    qualified: false,
    reason: "awaiting referred install activity threshold"
  });
}
