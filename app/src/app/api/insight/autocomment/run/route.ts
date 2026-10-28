import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/scope";
import { runAutoComment } from "@/lib/autocomment";
import { errorResponse } from "../../_util";

// POST → run the auto-comment job now for this user's rules ("Chạy ngay").
export async function POST() {
  try {
    const ownerId = await getOwnerId();
    return NextResponse.json({ summary: await runAutoComment({ ownerId }) });
  } catch (e) {
    return errorResponse(e);
  }
}
