import { NextResponse } from "next/server";
import { getSchedulerStatus, runAutoFetchAll } from "@/lib/scheduler";

export async function GET() {
  return NextResponse.json(getSchedulerStatus());
}

export async function POST() {
  const status = getSchedulerStatus();
  if (status.running) {
    return NextResponse.json({ error: "Đang chạy, vui lòng đợi" }, { status: 409 });
  }
  runAutoFetchAll().catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[scheduler] manual trigger failed:", e);
  });
  return NextResponse.json({ ok: true, triggered: true });
}
