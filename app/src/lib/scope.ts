// Multi-tenant data scope helper. Every API route that reads/writes user
// data should call `getOwnerId()` and either filter `WHERE owner_user_id = N`
// on selects, or stamp `ownerUserId: N` on inserts.
//
// This wraps `requireUser()` so unauthorized requests get a 401 thrown
// (caught by route handlers and translated to JSON), AND extracts the
// session user's id for query scoping.

import { requireUser, type CurrentUser } from "@/lib/auth";

export async function getOwnerId(): Promise<number> {
  const user = await requireUser();
  return user.id;
}

export async function getCurrentScopedUser(): Promise<CurrentUser> {
  return requireUser();
}
