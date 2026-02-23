const baseUrl = process.env.TOOLSPEC_BASE_URL || "https://toolspec.dev";
const token = process.env.TOOLSPEC_ADMIN_TOKEN;

if (!token) {
  console.error("TOOLSPEC_ADMIN_TOKEN is required");
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/v1/admin/reseed`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`
  }
});

const bodyText = await response.text();
if (!response.ok) {
  console.error(`Reseed failed (${response.status})`);
  console.error(bodyText);
  process.exit(1);
}

console.log(bodyText);
