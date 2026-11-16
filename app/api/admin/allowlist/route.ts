// Removed: AvrixCall no longer has an allowlist (plain Jitsi, no rules).
// This stub keeps the old endpoint from serving the removed feature.
// Snapshot pushes cannot delete files, so the removal is a 410 here.

function gone() {
  return Response.json({ error: "removed" }, { status: 410 });
}

export async function GET() {
  return gone();
}

export async function POST() {
  return gone();
}

export async function DELETE() {
  return gone();
}

export async function PATCH() {
  return gone();
}
