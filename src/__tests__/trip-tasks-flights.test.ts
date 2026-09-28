import { describe, it, expect } from "vitest"
import {
  TRIP_TASK_KINDS,
  TRIP_TASK_LABELS,
  computeTripTasks,
  countTasksByKind,
  sortTripTasks,
  tripLevelTasks,
  type TaskSubject,
  type TripLevelContext,
} from "@/lib/trip-tasks"

const NOW = new Date("2026-06-10T12:00:00.000Z")

function ctx(overrides: Partial<TripLevelContext> = {}): TripLevelContext {
  return {
    hasOrigin: true,
    hasDestination: true,
    hasDates: true,
    flightCount: 0,
    startDate: "2026-07-01",
    ...overrides,
  }
}

describe("BOOK_FLIGHTS kind registration", () => {
  it("is a known kind with a label", () => {
    expect(TRIP_TASK_KINDS).toContain("BOOK_FLIGHTS")
    expect(TRIP_TASK_LABELS.BOOK_FLIGHTS).toBe("Book flights")
  })

  it("is counted alongside the item kinds", () => {
    const tasks = tripLevelTasks(ctx(), NOW)
    expect(countTasksByKind(tasks).BOOK_FLIGHTS).toBe(1)
    expect(countTasksByKind([]).BOOK_FLIGHTS).toBe(0)
  })
})

describe("tripLevelTasks", () => {
  it("raises BOOK_FLIGHTS for a future trip with origin, destination, dates and no flights", () => {
    const tasks = tripLevelTasks(ctx(), NOW)
    expect(tasks).toHaveLength(1)
    const task = tasks[0]
    expect(task.kind).toBe("BOOK_FLIGHTS")
    expect(task.label).toBe("Book flights")
    // Trip-level: there is no itinerary item to deep-link to.
    expect(task.itineraryItemId).toBeNull()
    expect(task.date).toBe("2026-07-01")
    expect(task.dueAt).toBeNull()
  })

  it("clears as soon as any Flight row exists", () => {
    expect(tripLevelTasks(ctx({ flightCount: 1 }), NOW)).toEqual([])
    expect(tripLevelTasks(ctx({ flightCount: 4 }), NOW)).toEqual([])
  })

  it("needs an origin", () => {
    expect(tripLevelTasks(ctx({ hasOrigin: false }), NOW)).toEqual([])
  })

  it("needs a destination", () => {
    expect(tripLevelTasks(ctx({ hasDestination: false }), NOW)).toEqual([])
  })

  it("needs dates", () => {
    expect(tripLevelTasks(ctx({ hasDates: false }), NOW)).toEqual([])
    expect(tripLevelTasks(ctx({ startDate: null }), NOW)).toEqual([])
  })

  it("does not nag once the trip has started or finished", () => {
    expect(tripLevelTasks(ctx({ startDate: "2026-06-01" }), NOW)).toEqual([])
    // The start day itself is already underway at NOW (12:00Z on that day).
    expect(tripLevelTasks(ctx({ startDate: "2026-06-10" }), NOW)).toEqual([])
    expect(tripLevelTasks(ctx({ startDate: "2026-06-11" }), NOW)).toHaveLength(1)
  })

  it("ignores a malformed start date", () => {
    expect(tripLevelTasks(ctx({ startDate: "not-a-date" }), NOW)).toEqual([])
  })
})

describe("merging with item tasks", () => {
  const flaggedMeal: TaskSubject = {
    itineraryItemId: "meal-1",
    title: "Dinner",
    type: "MEAL",
    date: "2026-07-02",
    startTime: "19:00",
    needsReservation: true,
    hasAttachments: false,
    reservation: null,
    departureTime: null,
  }

  it("does not alter computeTripTasks, which only sees itinerary items", () => {
    const tasks = computeTripTasks([flaggedMeal], NOW)
    expect(tasks.map((t) => t.kind)).toEqual(["MAKE_RESERVATION"])
  })

  it("sorts BOOK_FLIGHTS ahead of undated reservation chores but behind real deadlines", () => {
    const dueSoon: TaskSubject = {
      ...flaggedMeal,
      itineraryItemId: "hotel-1",
      title: "Hotel balance",
      type: "HOTEL_CHECK_IN",
      needsReservation: false,
      reservation: {
        status: "CONFIRMED",
        confirmationNumber: "B2",
        balanceDue: 300,
        balanceDueDate: "2026-06-12T00:00:00.000Z",
      },
    }
    const merged = sortTripTasks([
      ...computeTripTasks([flaggedMeal, dueSoon], NOW),
      ...tripLevelTasks(ctx(), NOW),
    ])
    expect(merged.map((t) => t.kind)).toEqual(["MAKE_PAYMENT", "BOOK_FLIGHTS", "MAKE_RESERVATION"])
  })
})
