import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url)
    return NextResponse.redirect(loginUrl)
  }
})

export const config = {
  matcher: [
    /*
     * Match all routes EXCEPT:
     * - / (home)
     * - /login
     * - /shared/:path*
     * - /api/auth/:path*
     * - /api/health
     * - _next/static, _next/image, favicon.ico, etc.
     */
    "/((?!$|login|shared/.*|api/auth/.*|api/health|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
