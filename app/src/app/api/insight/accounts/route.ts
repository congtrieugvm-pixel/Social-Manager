import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups } from "@/lib/db/schema";
import { AuthError } from "@/lib/auth";
import { getOwnerId } from "@/lib/scope";
import { listInsightAccounts } from "@/lib/insight-accounts";

// Facebook accounts usable as page-token sources for the Insight screen, plus
// the owner's groups (pages inherit the groups of the accounts managing them).
export async function GET() {
  try {
    const ownerId = await getOwnerId();
    const accounts = await listInsightAccounts(ownerId);
    const groupRows = await db
      .select({ id: groups.id, name: groups.name, color: groups.color })
      .from(groups)
      .where(and(eq(groups.ownerUserId, ownerId)))
      .orderBy(asc(groups.name));
    return NextResponse.json({ accounts, groups: groupRows });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Lỗi server: ${msg}` }, { status: 500 });
  }
}
