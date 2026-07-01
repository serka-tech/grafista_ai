import { NextResponse, type NextRequest } from 'next/server';

// Matches the API's SESSION_COOKIE_NAME (apps/api/src/auth/session-token.ts).
const SESSION_COOKIE_NAME = 'grafista_session';

// Lightweight gate: only checks the session cookie's presence, not its
// validity against PostgreSQL (that happens on every real API call via
// requireAuth). This prevents rendering any page shell without a cookie at
// all; a revoked/expired-but-still-present cookie is caught by the API and
// the dashboard's fetch layer redirects to /login on the first 401.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSession && pathname !== '/login') {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
