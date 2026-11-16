// Removed: AvrixCall no longer tracks blocked attempts (plain Jitsi, no rules).
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
