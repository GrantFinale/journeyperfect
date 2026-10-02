import { NextRequest, NextResponse } from "next/server"

export function middleware(req: NextRequest) {
  // Check for NextAuth session cookie (works on edge without Prisma)
  const sessionCookie =
    req.cookies.get("__Secure-authjs.session-token") ??
    req.cookies.get("authjs.session-token")

  if (!sessionCookie) {
    const loginUrl = new URL("/login", req.url)
    return NextResponse.redirect(loginUrl)
  }
}

export const config = {
  matcher: [
    /*
     * Match all routes EXCEPT:
     * - / (home)
     * - /login
     * - /shared/:path*
     * - /api/auth/:path*
     * - /api/health
     * - /api/mcp and /api/cron/* (bearer-authenticated by their own handlers)
     * - /api/private-rates/capture (capture-token authenticated; the Go Rates extension posts here)
     * - _next/static, _next/image, favicon.ico, etc.
     */
    "/((?!$|login|shared/.*|api/auth/.*|api/health|api/mcp$|api/private-rates/capture$|api/cron/.*|api/stripe/.*|api/inbound-email|api/trip/.*/calendar|_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
