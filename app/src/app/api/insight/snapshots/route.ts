import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/scope";
import { loadSnapshots, type SnapshotKind } from "@/lib/insight-snapshots";
import { errorResponse } from "../_util";

const KINDS: SnapshotKind[] = ["reach", "monet", "pages"];

// GET /api/insight/snapshots?kind=reach|monet|pages
// → { items: { [key]: { data, fetchedAt } }, now } — last saved results, no Graph call.
export async function GET(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const kind = new URL(req.url).searchParams.get("kind") as SnapshotKind;
    if (!KINDS.includes(kind)) {
      return NextResponse.json({ error: "kind phải là reach, monet hoặc pages" }, { status: 400 });
    }
    return NextResponse.json(
      { items: await loadSnapshots(ownerId, kind), now: Math.floor(Date.now() / 1000) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
