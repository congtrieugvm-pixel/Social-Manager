import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { TokenInputError } from "@/lib/insight-tokens";

/** Map thrown errors to JSON responses for the /api/insight routes. */
export function errorResponse(e: unknown) {
  if (e instanceof AuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof TokenInputError) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/UNIQUE constraint/i.test(msg)) {
    return NextResponse.json({ error: "Tên nhóm đã tồn tại" }, { status: 409 });
  }
  console.error("[insight]", e);
  return NextResponse.json({ error: `Lỗi server: ${msg}` }, { status: 500 });
}

export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
