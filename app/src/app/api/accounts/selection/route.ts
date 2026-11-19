import { NextResponse } from 'next/server';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { accounts } from '@/lib/db/schema';
import { getOwnerId } from '@/lib/scope';
import { AuthError } from '@/lib/auth';
import { readBody } from '@/lib/req-body';

export async function POST(req: Request) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, {
    status, headers: { 'Cache-Control': 'no-store' },
  });
  try {
    const owner = await getOwnerId();
    const body = await readBody<{ groups?: unknown }>(req);
    if (!Array.isArray(body?.groups) || body.groups.length === 0 || body.groups.length > 200 ||
        body.groups.some(id => id !== 'none' && (!Number.isSafeInteger(id) || id < 1))) {
      return reply({ error: 'Chọn nhóm hợp lệ.' }, 400);
    }
    const groupIds = body.groups.filter((id): id is number => typeof id === 'number');
    const selected = await db.select({ id: accounts.id }).from(accounts).where(and(
      eq(accounts.ownerUserId, owner),
      or(groupIds.length ? inArray(accounts.groupId, groupIds) : undefined,
        body.groups.includes('none') ? isNull(accounts.groupId) : undefined),
    ));
    return reply({ ids: selected.map(account => account.id) });
  } catch (error) {
    if (error instanceof AuthError) return reply({ error: error.message }, error.status);
    return reply({ error: 'Không thể chọn tài khoản theo nhóm.' }, 500);
  }
}
