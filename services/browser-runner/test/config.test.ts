import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { loadConfig, toWsBase } from "../src/config.js"

const good = {
  BROWSER_RUNNER_SECRET: "s".repeat(32),
  PRIVATE_RATES_MASTER_KEY: randomBytes(32).toString("base64"),
}

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({ ...good })
    expect(c.port).toBe(8787)
    expect(c.dataDir).toBe("/data")
    expect(c.sessionLoginTimeoutMs).toBe(600_000)
    expect(c.maxRunMs).toBe(180_000)
    expect(c.headless).toBe(true)
    expect(c.liveViewDefaulted).toBe(true)
    expect(c.liveViewPublicUrl).toBe("ws://localhost:8787")
    expect(c.masterKey.length).toBe(32)
    expect(c.hiltonRateCodeParam).toBe("corporateCode")
  })

  it("requires the secret and a 32-byte master key", () => {
    expect(() => loadConfig({ PRIVATE_RATES_MASTER_KEY: good.PRIVATE_RATES_MASTER_KEY })).toThrow(/BROWSER_RUNNER_SECRET/)
    expect(() => loadConfig({ BROWSER_RUNNER_SECRET: good.BROWSER_RUNNER_SECRET })).toThrow(/PRIVATE_RATES_MASTER_KEY/)
    expect(() =>
      loadConfig({ ...good, PRIVATE_RATES_MASTER_KEY: randomBytes(16).toString("base64") }),
    ).toThrow(/at least 32 bytes/)
  })

  it("converts the public live-view URL to ws(s)", () => {
    expect(loadConfig({ ...good, LIVE_VIEW_PUBLIC_URL: "https://runner.example.com/" }).liveViewPublicUrl).toBe(
      "wss://runner.example.com",
    )
    expect(toWsBase("http://runner:8787")).toBe("ws://runner:8787")
    expect(() => toWsBase("ftp://x")).toThrow()
  })

  it("validates integer envs", () => {
    expect(() => loadConfig({ ...good, MAX_RUN_MS: "abc" })).toThrow(/MAX_RUN_MS/)
    expect(() => loadConfig({ ...good, PORT: "0" })).toThrow(/PORT/)
    expect(loadConfig({ ...good, HEADLESS: "false" }).headless).toBe(false)
  })
})
