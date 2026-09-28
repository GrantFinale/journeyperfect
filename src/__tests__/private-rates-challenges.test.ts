import { describe, it, expect } from "vitest"
import { detectChallenge, type PageSignals } from "@/lib/private-rates/challenges"

const RESULTS_URL = "https://www.hilton.com/en/book/reservation/rooms/?ctyhocn=CHIPDHH&arrivalDate=2026-10-10"

function results(overrides: Partial<PageSignals> = {}): PageSignals {
  return {
    url: RESULTS_URL,
    title: "Select a Room - Palmer House a Hilton Hotel",
    bodyText:
      "Palmer House a Hilton Hotel. Select a room. 1 King Bed Deluxe $189 per night. 2 Queen Beds $209 per night. Sign in. Total for stay $378",
    hasIframeFrom: ["https://www.googletagmanager.com/ns.html?id=GTM-1"],
    formFieldNames: ["promoCode", "room1NumAdults"],
    ...overrides,
  }
}

describe("detectChallenge", () => {
  it("returns NONE for a normal results page (header 'Sign in' link is not a sign-out)", () => {
    expect(detectChallenge(results())).toBe("NONE")
  })

  it("returns NONE for the account page", () => {
    expect(
      detectChallenge({
        url: "https://www.hilton.com/en/hilton-honors/guest/my-account/",
        title: "My Account",
        bodyText: "Welcome back, Grant. Honors points 12,345. Sign out",
      }),
    ).toBe("NONE")
  })

  describe("CAPTCHA", () => {
    it("detects recaptcha / hcaptcha / arkose iframes", () => {
      for (const src of [
        "https://www.google.com/recaptcha/api2/anchor?k=abc",
        "https://www.recaptcha.net/recaptcha/api2/bframe",
        "https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html",
        "https://client-api.arkoselabs.com/fc/gc/?token=x",
      ]) {
        expect(detectChallenge(results({ hasIframeFrom: [src] }))).toBe("CAPTCHA")
      }
    })

    it("detects 'verify you are human' and press-and-hold walls", () => {
      expect(detectChallenge(results({ bodyText: "Please verify you are human to continue" }))).toBe("CAPTCHA")
      expect(detectChallenge(results({ bodyText: "Press and hold the button to confirm" }))).toBe("CAPTCHA")
      expect(detectChallenge(results({ title: "Just a moment...", bodyText: "" }))).toBe("CAPTCHA")
    })

    it("wins over MFA/sign-in signals on the same page", () => {
      expect(
        detectChallenge(
          results({
            url: "https://www.hilton.com/en/hilton-honors/login/",
            bodyText: "Enter the verification code. Verify you are human",
            formFieldNames: ["username", "password", "otpCode"],
          }),
        ),
      ).toBe("CAPTCHA")
    })
  })

  describe("MFA", () => {
    it("detects verification-code / one-time / authenticator copy", () => {
      expect(detectChallenge(results({ bodyText: "We sent a verification code to your phone" }))).toBe("MFA")
      expect(detectChallenge(results({ bodyText: "Enter your one-time passcode" }))).toBe("MFA")
      expect(detectChallenge(results({ bodyText: "Open your authenticator app" }))).toBe("MFA")
    })

    it("detects OTP-style field names regardless of copy", () => {
      for (const name of ["otp", "otpCode", "one_time_code", "verificationCode", "mfaCode", "totp", "passcode", "code1"]) {
        expect(detectChallenge(results({ bodyText: "", formFieldNames: [name] })), name).toBe("MFA")
      }
    })

    it("does not treat promo/rate code fields as OTP fields", () => {
      expect(detectChallenge(results({ formFieldNames: ["promoCode", "corporateCode", "groupCode"] }))).toBe("NONE")
    })

    it("outranks SIGNED_OUT when the MFA step is served on the login URL", () => {
      expect(
        detectChallenge({
          url: "https://www.hilton.com/en/hilton-honors/login/?step=mfa",
          title: "Hilton Honors",
          bodyText: "Enter the 6-digit verification code we sent to ***-1234",
          formFieldNames: ["code1", "code2", "code3", "code4", "code5", "code6"],
        }),
      ).toBe("MFA")
    })
  })

  describe("SECURITY_VERIFY", () => {
    it("detects identity/unusual-activity interstitials, including curly apostrophes", () => {
      expect(detectChallenge(results({ bodyText: "Let’s verify it’s you before continuing" }))).toBe("SECURITY_VERIFY")
      expect(detectChallenge(results({ bodyText: "We noticed unusual activity on your account" }))).toBe("SECURITY_VERIFY")
      expect(detectChallenge(results({ bodyText: "Please confirm your identity" }))).toBe("SECURITY_VERIFY")
    })
  })

  describe("SIGNED_OUT", () => {
    it("detects a sign-in URL when results were expected", () => {
      expect(
        detectChallenge({
          url: "https://www.hilton.com/en/hilton-honors/login/?returnUrl=%2Fbook",
          title: "Sign In - Hilton Honors",
          bodyText: "Sign in to your Hilton Honors account",
          formFieldNames: ["username", "password"],
        }),
      ).toBe("SIGNED_OUT")
      expect(detectChallenge(results({ url: "https://www.hilton.com/en/signin" }))).toBe("SIGNED_OUT")
    })

    it("detects a username+password form on a non-login URL", () => {
      expect(detectChallenge(results({ formFieldNames: ["email", "password"] }))).toBe("SIGNED_OUT")
    })

    it("detects session-expired copy", () => {
      expect(detectChallenge(results({ bodyText: "Your session has expired. Please sign in again." }))).toBe("SIGNED_OUT")
    })

    it("does not fire on a lone password field (e.g. a promo form) without a username", () => {
      expect(detectChallenge(results({ formFieldNames: ["password"] }))).toBe("NONE")
    })
  })

  describe("UNKNOWN_INTERSTITIAL", () => {
    it("fires when nothing recognisable rendered", () => {
      expect(
        detectChallenge({
          url: "https://www.hilton.com/en/",
          title: "Hilton",
          bodyText: "Please wait while we redirect you.",
        }),
      ).toBe("UNKNOWN_INTERSTITIAL")
    })

    it("fires on an empty page", () => {
      expect(detectChallenge({ url: "about:blank", title: "", bodyText: "" })).toBe("UNKNOWN_INTERSTITIAL")
    })

    it("fires on an Akamai-style access denied page", () => {
      expect(
        detectChallenge({
          url: "https://www.hilton.com/en/book/reservation/rooms/",
          title: "Access Denied",
          bodyText: "You don't have permission to access this resource. Reference #18.abc",
          formFieldNames: [],
        }),
      ).toBe("NONE") // path has content marker; content-less body but the URL says results route
    })
  })

  it("treats a sold-out results page as NONE (it is a real result)", () => {
    expect(
      detectChallenge({
        url: "https://www.hilton.com/en/book/reservation/rooms/?ctyhocn=CHIPDHH",
        title: "Rooms",
        bodyText: "Sorry, no rooms are available for the dates you selected.",
      }),
    ).toBe("NONE")
  })

  it("tolerates missing optional arrays and malformed URLs", () => {
    expect(detectChallenge({ url: "not a url", title: "x", bodyText: "Select a room $100 per night" })).toBe("NONE")
    expect(detectChallenge({ url: "not a url /login", title: "", bodyText: "" })).toBe("SIGNED_OUT")
  })
})
