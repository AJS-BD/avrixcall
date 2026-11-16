// Removed: blocked attempts are logged by the join route, but there is no admin feed for them yet.
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
