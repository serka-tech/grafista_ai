import { NextResponse, type NextRequest } from 'next/server';

// Matches the API's SESSION_COOKIE_NAME (apps/api/src/auth/session-token.ts).
const SESSION_COOKIE_NAME = 'grafista_session';

// Lightweight gate: only checks the session cookie's presence, not its
// validity against PostgreSQL (that happens on every real API call via
// requireAuth). This prevents rendering any page shell without a cookie at
// all; a revoked/expired-but-still-present cookie is caught by the API and
// the dashboard's fetch layer redirects to /login on the first 401.
// Pages reachable WITHOUT a session cookie: login, and accept-invite (the
// invitee has no session yet — they set their password from a one-time token).
const PUBLIC_PATHS = new Set(['/login', '/accept-invite']);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSession && !PUBLIC_PATHS.has(pathname)) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // `/api/*` is intentionally EXCLUDED. Those requests are proxied to the
  // backend API (next.config.js rewrite), which enforces its own auth. Next.js
  // middleware runs BEFORE rewrites, so gating `/api/*` here would (1) turn the
  // same-origin `/api/health` connectivity probe into a `/login` redirect and
  // (2) break the unauthenticated `POST /api/auth/login` by redirecting it away
  // from the backend (login never gets a cookie). Page routes stay gated; API
  // 401s are surfaced to the fetch layer (api.ts), which redirects to /login.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
