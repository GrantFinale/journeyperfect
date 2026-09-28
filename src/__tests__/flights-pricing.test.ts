import { describe, it, expect } from "vitest"
import { isNewLow, priceVerdict, shouldAlert } from "@/lib/flights/pricing"
import type { PriceInsight } from "@/lib/flights/types"

const insight: PriceInsight = { lowestPrice: 189, typicalLow: 230, typicalHigh: 420, level: "LOW" }

describe("priceVerdict", () => {
  it("uses Google's typical range when present", () => {
    expect(priceVerdict(200, insight).level).toBe("LOW")
    expect(priceVerdict(300, insight).level).toBe("TYPICAL")
    expect(priceVerdict(500, insight).level).toBe("HIGH")
  })

  it("reports deltas from the typical midpoint and the lowest known price", () => {
    const v = priceVerdict(300, insight, [350, 280])
    expect(v.deltaFromTypical).toBe(-25) // midpoint 325
    expect(v.deltaFromLowest).toBe(111) // min(189, 280)
  })

  it("falls back to the provider level when there is no range", () => {
    expect(priceVerdict(300, { lowestPrice: 250, level: "HIGH" }).level).toBe("HIGH")
  })

  it("falls back to our own history with three or more samples", () => {
    const history = [400, 380, 360, 340, 320]
    expect(priceVerdict(300, undefined, history).level).toBe("LOW")
    expect(priceVerdict(360, undefined, history).level).toBe("TYPICAL")
    expect(priceVerdict(450, undefined, history).level).toBe("HIGH")
    expect(priceVerdict(300, null, history).deltaFromLowest).toBe(-20)
  })

  it("is UNKNOWN with nothing to compare against or a bad price", () => {
    expect(priceVerdict(300, undefined, [])).toEqual({ level: "UNKNOWN" })
    expect(priceVerdict(300, undefined, [310, 320]).level).toBe("UNKNOWN")
    expect(priceVerdict(NaN, insight).level).toBe("UNKNOWN")
  })
})

describe("isNewLow", () => {
  it("is true only when strictly below the previous low", () => {
    expect(isNewLow(180, 189)).toBe(true)
    expect(isNewLow(189, 189)).toBe(false)
    expect(isNewLow(180, null)).toBe(false)
    expect(isNewLow(180, undefined)).toBe(false)
  })
})

describe("shouldAlert", () => {
  it("fires TARGET_HIT at or below the target, with the highest priority", () => {
    expect(shouldAlert({ targetPrice: 250, lastPrice: 400, lowestPrice: 300 }, 250)).toEqual({ alert: true, reason: "TARGET_HIT" })
    expect(shouldAlert({ targetPrice: 250, lastPrice: 251, lowestPrice: 251 }, 249)).toEqual({ alert: true, reason: "TARGET_HIT" })
  })

  it("fires NEW_LOW below the best ever seen", () => {
    expect(shouldAlert({ targetPrice: 100, lastPrice: 320, lowestPrice: 300 }, 290)).toEqual({ alert: true, reason: "NEW_LOW" })
  })

  it("fires DROP_10PCT on a >=10% fall since the last check", () => {
    expect(shouldAlert({ lastPrice: 400, lowestPrice: 200 }, 360)).toEqual({ alert: true, reason: "DROP_10PCT" })
    expect(shouldAlert({ lastPrice: 400, lowestPrice: 200 }, 361)).toEqual({ alert: false, reason: null })
  })

  it("stays quiet on a first check without a target, and on bad input", () => {
    expect(shouldAlert({}, 300)).toEqual({ alert: false, reason: null })
    expect(shouldAlert({ targetPrice: null, lastPrice: null, lowestPrice: null }, 300)).toEqual({ alert: false, reason: null })
    expect(shouldAlert({ targetPrice: 500 }, NaN)).toEqual({ alert: false, reason: null })
  })

  it("does not alert when the price is unchanged or higher", () => {
    expect(shouldAlert({ targetPrice: 100, lastPrice: 300, lowestPrice: 300 }, 300)).toEqual({ alert: false, reason: null })
    expect(shouldAlert({ targetPrice: 100, lastPrice: 300, lowestPrice: 300 }, 350)).toEqual({ alert: false, reason: null })
  })
})
