import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runAutoComment } from "@/lib/autocomment";

// POST → auto-comment job for every user, called every 5 minutes by the cron
// Worker (workers/cron) through its service binding. Guarded by the shared
// CRON_SECRET (a Worker secret on both Workers); unset = disabled.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const summary = await runAutoComment();
    return NextResponse.json({ summary });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
