import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Cookie presence is checked here (edge runtime) — actual session validity is
// re-checked inside route handlers / `requireUser()` because we cannot hit
// SQLite from the edge.
const SESSION_COOKIE = "sm_session";

// Routes that must work without a session.
const PUBLIC_PAGE_PATHS = new Set(["/login", "/register"]);
const PUBLIC_API_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/oauth/", // FB / MS OAuth callbacks
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = !!req.cookies.get(SESSION_COOKIE)?.value;

  if (PUBLIC_PAGE_PATHS.has(pathname)) {
    if (hasSession) {
      // Already logged in — bounce to home.
      const home = new URL("/", req.url);
      return NextResponse.redirect(home);
    }
    return NextResponse.next();
  }

  for (const prefix of PUBLIC_API_PREFIXES) {
    if (pathname.startsWith(prefix)) return NextResponse.next();
  }

  if (!hasSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Chưa đăng nhập" },
        { status: 401 },
      );
    }
    const login = new URL("/login", req.url);
    if (pathname && pathname !== "/") {
      login.searchParams.set("from", pathname);
    }
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals + static assets so middleware doesn't run for them.
  matcher: [
    "/((?!_next/|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|woff2?)$).*)",
  ],
};
