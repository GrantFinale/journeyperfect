import { describe, it, expect } from "vitest"
import {
  optimizeItinerary,
  parseCityFromAddress,
  isWithinDayBase,
  MAX_DAY_RADIUS_KM,
  type ActivityInput,
  type OptimizerConfig,
  type DayBase,
} from "@/lib/optimizer"
import { MEAL_WINDOWS } from "@/lib/meal-slots"

const CHICAGO: DayBase = { lat: 41.8919, lng: -87.6051, city: "Chicago", name: "Embassy Suites Chicago" }
const DELLS: DayBase = { lat: 43.6275, lng: -89.7712, city: "Wisconsin Dells", name: "Dells Lodge" }

function activity(over: Partial<ActivityInput> & { id: string }): ActivityInput {
  return {
    name: over.id,
    durationMins: 120,
    priority: "HIGH",
    isFixed: false,
    costPerAdult: 0,
    costPerChild: 0,
    status: "WISHLIST",
    ...over,
  }
}

function config(over: Partial<OptimizerConfig> = {}): OptimizerConfig {
  return {
    startDate: new Date("2026-08-22T00:00:00Z"),
    endDate: new Date("2026-08-22T00:00:00Z"),
    dayBases: { "2026-08-22": CHICAGO },
    pacingStyle: "PACKED",
    wakeUpTime: "07:00",
    bedTime: "23:00",
    adultCount: 2,
    childCount: 0,
    ...over,
  }
}

function minsOf(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + m
}

describe("parseCityFromAddress", () => {
  it("pulls the city out of a US Google address", () => {
    expect(parseCityFromAddress("600 N State St, Chicago, IL 60654, USA")).toBe("Chicago")
    expect(parseCityFromAddress("1101 Wisconsin Dells Pkwy, Wisconsin Dells, WI 53965")).toBe(
      "Wisconsin Dells"
    )
  })

  it("returns null when there is no city segment", () => {
    expect(parseCityFromAddress(null)).toBeNull()
    expect(parseCityFromAddress("Main Street")).toBeNull()
  })
})

describe("geo-fence", () => {
  it("rejects an activity beyond the max radius from the day base", () => {
    const dells = activity({ id: "dells", lat: 43.6275, lng: -89.7712 })
    expect(isWithinDayBase(dells, CHICAGO)).toBe(false)
    expect(isWithinDayBase(dells, DELLS)).toBe(true)
  })

  it("falls back to city matching when the activity has no coordinates", () => {
    const noCoords = activity({ id: "x", address: "123 Main St, Wisconsin Dells, WI 53965" })
    expect(isWithinDayBase(noCoords, CHICAGO)).toBe(false)
    expect(isWithinDayBase(noCoords, DELLS)).toBe(true)
  })

  it("keeps a nearby activity inside the fence", () => {
    // Navy Pier, ~2km from the base — well inside MAX_DAY_RADIUS_KM
    const navyPier = activity({ id: "pier", lat: 41.8917, lng: -87.6086 })
    expect(MAX_DAY_RADIUS_KM).toBeGreaterThan(10)
    expect(isWithinDayBase(navyPier, CHICAGO)).toBe(true)
  })

  it("never schedules an out-of-city activity on a day based elsewhere", () => {
    const result = optimizeItinerary(
      [
        activity({ id: "dells-waterpark", lat: 43.6275, lng: -89.7712, priority: "MUST_DO" }),
        activity({ id: "art-institute", lat: 41.8796, lng: -87.6237 }),
      ],
      [],
      config()
    )

    const ids = result.scheduledItems.map((i) => i.activityId)
    expect(ids).toContain("art-institute")
    expect(ids).not.toContain("dells-waterpark")
    expect(result.unscheduled.map((u) => u.activityId)).toContain("dells-waterpark")
  })

  it("resets the base per day rather than reusing the first hotel", () => {
    const result = optimizeItinerary(
      [
        activity({ id: "dells-waterpark", lat: 43.6275, lng: -89.7712 }),
        activity({ id: "art-institute", lat: 41.8796, lng: -87.6237 }),
      ],
      [],
      config({
        endDate: new Date("2026-08-23T00:00:00Z"),
        dayBases: { "2026-08-22": CHICAGO, "2026-08-23": DELLS },
      })
    )

    const byId = new Map(result.scheduledItems.map((i) => [i.activityId, i]))
    expect(byId.get("art-institute")?.date.toISOString().slice(0, 10)).toBe("2026-08-22")
    expect(byId.get("dells-waterpark")?.date.toISOString().slice(0, 10)).toBe("2026-08-23")
  })
})

describe("meal scheduling", () => {
  const dinnerVenue = (id: string) =>
    activity({
      id,
      lat: 41.89,
      lng: -87.62,
      category: "restaurant",
      mealSlots: JSON.stringify(["dinner"]),
      durationMins: 90,
    })

  it("never schedules two dinners back to back", () => {
    const result = optimizeItinerary(
      [dinnerVenue("bellos"), dinnerVenue("sneaky-petes")],
      [],
      config()
    )

    const meals = result.scheduledItems.filter((i) => i.type === "MEAL")
    expect(meals).toHaveLength(1)
    expect(result.unscheduled.map((u) => u.activityId)).toHaveLength(1)
  })

  it("places a dinner inside the dinner window near its target", () => {
    const result = optimizeItinerary([dinnerVenue("bellos")], [], config())

    const meal = result.scheduledItems.find((i) => i.type === "MEAL")!
    expect(meal.mealSlot).toBe("dinner")
    expect(minsOf(meal.startTime)).toBeGreaterThanOrEqual(MEAL_WINDOWS.dinner.startMin)
    expect(minsOf(meal.endTime)).toBeLessThanOrEqual(MEAL_WINDOWS.dinner.endMin)
    expect(minsOf(meal.startTime)).toBe(MEAL_WINDOWS.dinner.targetMin)
  })

  it("allows one venue per slot across different slots", () => {
    const breakfast = activity({
      id: "cafe",
      lat: 41.89,
      lng: -87.62,
      category: "cafe",
      mealSlots: JSON.stringify(["breakfast"]),
      durationMins: 60,
    })
    const result = optimizeItinerary([breakfast, dinnerVenue("bellos")], [], config())

    const meals = result.scheduledItems.filter((i) => i.type === "MEAL")
    expect(meals.map((m) => m.mealSlot).sort()).toEqual(["breakfast", "dinner"])
  })

  it("uses the meal window default duration when the activity has none", () => {
    const noDuration = activity({
      id: "lunch-spot",
      lat: 41.89,
      lng: -87.62,
      category: "restaurant",
      mealSlots: JSON.stringify(["lunch"]),
      durationMins: 0,
    })
    const meal = optimizeItinerary([noDuration], [], config()).scheduledItems.find(
      (i) => i.type === "MEAL"
    )!
    expect(meal.durationMins).toBe(MEAL_WINDOWS.lunch.durationMins)
  })

  it("leaves a restaurant with unknown meal times in the wishlist", () => {
    const unknown = activity({ id: "mystery", lat: 41.89, lng: -87.62, category: "restaurant" })
    const result = optimizeItinerary([unknown], [], config())

    expect(result.scheduledItems).toHaveLength(0)
    expect(result.unscheduled[0].activityId).toBe("mystery")
    expect(result.unscheduled[0].reason).toMatch(/meal times/i)
  })

  it("does not let an activity overlap a placed meal", () => {
    const museum = activity({ id: "museum", lat: 41.88, lng: -87.62, durationMins: 180 })
    const result = optimizeItinerary([museum, dinnerVenue("bellos")], [], config())

    const meal = result.scheduledItems.find((i) => i.type === "MEAL")!
    const act = result.scheduledItems.find((i) => i.activityId === "museum")
    if (act) {
      const overlaps =
        minsOf(act.startTime) < minsOf(meal.endTime) && minsOf(act.endTime) > minsOf(meal.startTime)
      expect(overlaps).toBe(false)
    }
  })

  it("returns items in wall-clock order so positions are sane", () => {
    const breakfast = activity({
      id: "cafe",
      lat: 41.89,
      lng: -87.62,
      category: "coffee_shop",
      mealSlots: JSON.stringify(["breakfast"]),
      durationMins: 60,
    })
    const result = optimizeItinerary(
      [dinnerVenue("bellos"), breakfast, activity({ id: "museum", lat: 41.88, lng: -87.62 })],
      [],
      config()
    )

    const times = result.scheduledItems.map((i) => minsOf(i.startTime))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it("respects the geo-fence for restaurants too", () => {
    const dellsDinner = activity({
      id: "dells-dinner",
      lat: 43.6275,
      lng: -89.7712,
      category: "restaurant",
      mealSlots: JSON.stringify(["dinner"]),
    })
    const result = optimizeItinerary([dellsDinner], [], config())
    expect(result.scheduledItems).toHaveLength(0)
  })
})
