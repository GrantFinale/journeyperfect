import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { detectChallenge } from "../src/challenges.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const serviceCopy = path.resolve(here, "../src/challenges.ts")
const appCopy = path.resolve(here, "../../../src/lib/private-rates/challenges.ts")

/** The only permitted difference is the ESM import specifier for ./types. */
function normalize(src: string): string {
  return src.replace(/from "\.\/types\.js"/g, 'from "./types"')
}

describe("challenges.ts copy", () => {
  it("is identical to src/lib/private-rates/challenges.ts in the app", () => {
    if (!fs.existsSync(appCopy)) return // service checked out standalone
    expect(normalize(fs.readFileSync(serviceCopy, "utf8"))).toBe(normalize(fs.readFileSync(appCopy, "utf8")))
  })

  it("classifies the basics", () => {
    expect(
      detectChallenge({
        url: "https://www.hilton.com/en/book/reservation/rooms/?ctyhocn=CHIPDHH",
        title: "Rooms",
        bodyText: "Select a room. 1 King Bed $199 per night",
      }),
    ).toBe("NONE")
    expect(
      detectChallenge({
        url: "https://www.hilton.com/en/hilton-honors/login/",
        title: "Sign in",
        bodyText: "Sign in",
        formFieldNames: ["username", "password"],
      }),
    ).toBe("SIGNED_OUT")
    expect(
      detectChallenge({
        url: "https://www.hilton.com/en/book/reservation/rooms/",
        title: "x",
        bodyText: "",
        hasIframeFrom: ["https://www.google.com/recaptcha/api2/anchor"],
      }),
    ).toBe("CAPTCHA")
  })

  it("classifies Akamai block pages as BLOCKED, ahead of CAPTCHA", () => {
    const url = "https://www.hilton.com/en/hilton-honors/login/"
    expect(detectChallenge({ url, title: "Access Denied", bodyText: "" })).toBe("BLOCKED")
    expect(
      detectChallenge({ url, title: "Hilton", bodyText: "SOMETHING WENT WRONG. Please try again. Reference No. 18.8f2d3017.1759000000.1a2b3c4d" }),
    ).toBe("BLOCKED")
    expect(detectChallenge({ url, title: "", bodyText: "Something went wrong. Reference #18.ab12" })).toBe("BLOCKED")
    expect(
      detectChallenge({ url, title: "", bodyText: "You don't have permission to access \"http://www.hilton.com/\" on this server." }),
    ).toBe("BLOCKED")
    expect(detectChallenge({ url, title: "", bodyText: "https://errors.edgesuite.net/18.1234" })).toBe("BLOCKED")
    expect(
      detectChallenge({ url, title: "Access Denied", bodyText: "", hasIframeFrom: ["https://www.google.com/recaptcha/api2/anchor"] }),
    ).toBe("BLOCKED")
    // "Something went wrong" alone is not a block.
    expect(detectChallenge({ url: "https://www.hilton.com/en/book/reservation/rooms/", title: "", bodyText: "Something went wrong" })).not.toBe("BLOCKED")
  })
})
