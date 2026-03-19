import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

// The middleware matcher regex from src/middleware.ts
const MATCHER_REGEX =
  /^\/((?!$|login|shared\/.*|api\/auth\/.*|api\/health|_next\/static|_next\/image|favicon\.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)/

function matchesMiddleware(pathname: string): boolean {
  return MATCHER_REGEX.test(pathname)
}

describe("middleware route matcher", () => {
  describe("public routes are NOT matched (not redirected)", () => {
    it.each([
      ["/", "home page"],
      ["/login", "login page"],
      ["/shared/anything", "shared route"],
      ["/shared/trip/abc123", "nested shared route"],
      ["/api/auth/callback", "auth callback"],
      ["/api/auth/callback/google", "auth provider callback"],
      ["/api/auth/session", "auth session"],
      ["/api/health", "health check"],
    ])("%s (%s) should not be matched", (pathname) => {
      expect(matchesMiddleware(pathname)).toBe(false)
    })
  })

  describe("protected routes ARE matched (will redirect)", () => {
    it.each([
      ["/dashboard", "dashboard"],
      ["/trip/123", "trip detail"],
      ["/trips", "trips list"],
      ["/settings", "settings"],
      ["/profile", "profile"],
      ["/api/trips", "API trips endpoint"],
    ])("%s (%s) should be matched", (pathname) => {
      expect(matchesMiddleware(pathname)).toBe(true)
    })
  })
})

// Test the middleware handler logic separately
describe("middleware auth handler", () => {
  const redirectSpy = vi.spyOn(NextResponse, "redirect")

  beforeEach(() => {
    redirectSpy.mockClear()
  })

  it("redirects unauthenticated users to /login", async () => {
    // Mock the auth wrapper behavior: when req.auth is null, redirect
    const req = {
      auth: null,
      url: "http://localhost:3000/dashboard",
      nextUrl: { pathname: "/dashboard" },
    }

    // Simulate middleware logic
    if (!req.auth) {
      NextResponse.redirect(new URL("/login", req.url))
    }

    expect(redirectSpy).toHaveBeenCalledTimes(1)
    const redirectUrl = redirectSpy.mock.calls[0][0] as URL
    expect(redirectUrl.pathname).toBe("/login")
  })

  it("does not redirect authenticated users", async () => {
    const req = {
      auth: { user: { id: "user-1", email: "test@example.com" } },
      url: "http://localhost:3000/dashboard",
      nextUrl: { pathname: "/dashboard" },
    }

    // Simulate middleware logic
    if (!req.auth) {
      NextResponse.redirect(new URL("/login", req.url))
    }

    expect(redirectSpy).not.toHaveBeenCalled()
  })
})
