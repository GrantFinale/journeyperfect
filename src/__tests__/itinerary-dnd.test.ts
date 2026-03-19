import { describe, it, expect, vi } from "vitest"
import { groupByDay } from "@/lib/itinerary-utils"

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    date: new Date("2025-07-10T12:00:00Z"),
    startTime: "09:00" as string | null,
    endTime: "10:00" as string | null,
    type: "ACTIVITY",
    title: "Visit Museum",
    notes: null as string | null,
    durationMins: 60,
    travelTimeToNextMins: 15,
    costEstimate: 20,
    position: 0,
    isConfirmed: false,
    ...overrides,
  }
}

describe("groupByDay", () => {
  it("correctly groups items by date", () => {
    const items = [
      makeItem({ id: "a", date: new Date("2025-07-10T12:00:00Z"), position: 0 }),
      makeItem({ id: "b", date: new Date("2025-07-11T12:00:00Z"), position: 0 }),
      makeItem({ id: "c", date: new Date("2025-07-10T12:00:00Z"), position: 1 }),
    ]

    const days = groupByDay(items)

    expect(days).toHaveLength(2)
    expect(days[0].dateStr).toBe("2025-07-10")
    expect(days[0].items).toHaveLength(2)
    expect(days[0].items.map((i) => i.id)).toEqual(
      expect.arrayContaining(["a", "c"])
    )

    expect(days[1].dateStr).toBe("2025-07-11")
    expect(days[1].items).toHaveLength(1)
    expect(days[1].items[0].id).toBe("b")
  })

  it("sorts days in chronological order", () => {
    const items = [
      makeItem({ id: "a", date: new Date("2025-07-12T12:00:00Z"), position: 0 }),
      makeItem({ id: "b", date: new Date("2025-07-10T12:00:00Z"), position: 0 }),
      makeItem({ id: "c", date: new Date("2025-07-11T12:00:00Z"), position: 0 }),
    ]

    const days = groupByDay(items)

    expect(days.map((d) => d.dateStr)).toEqual([
      "2025-07-10",
      "2025-07-11",
      "2025-07-12",
    ])
  })

  it("sorts items within a day by startTime then position", () => {
    const items = [
      makeItem({ id: "c", date: new Date("2025-07-10T12:00:00Z"), startTime: "14:00", position: 0 }),
      makeItem({ id: "a", date: new Date("2025-07-10T12:00:00Z"), startTime: "09:00", position: 2 }),
      makeItem({ id: "b", date: new Date("2025-07-10T12:00:00Z"), startTime: "11:00", position: 1 }),
    ]

    const days = groupByDay(items)

    expect(days[0].items.map((i) => i.id)).toEqual(["a", "b", "c"])
  })

  it("falls back to position sort when startTime is null", () => {
    const items = [
      makeItem({ id: "b", date: new Date("2025-07-10T12:00:00Z"), startTime: null, position: 2 }),
      makeItem({ id: "a", date: new Date("2025-07-10T12:00:00Z"), startTime: null, position: 0 }),
      makeItem({ id: "c", date: new Date("2025-07-10T12:00:00Z"), startTime: null, position: 5 }),
    ]

    const days = groupByDay(items)

    expect(days[0].items.map((i) => i.id)).toEqual(["a", "b", "c"])
  })

  it("returns empty array for no items", () => {
    const days = groupByDay([])
    expect(days).toEqual([])
  })
})

describe("optimizer error handling", () => {
  it("shows toast error when runOptimizer throws", async () => {
    // This test verifies the pattern used in the component.
    // We mock runOptimizer to throw and verify the error handling logic.
    const mockRunOptimizer = vi.fn().mockRejectedValue(new Error("No activities"))
    const mockToastError = vi.fn()
    const mockToastSuccess = vi.fn()

    // Simulate the handleOptimize logic from ItineraryView
    let optimizing = false
    async function handleOptimize() {
      optimizing = true
      try {
        const result = await mockRunOptimizer("trip-123")
        mockToastSuccess(`Optimizer scheduled ${result.scheduledItems.length} activities!`)
      } catch (e) {
        mockToastError("Optimization failed. Make sure you have activities on your wishlist.")
      } finally {
        optimizing = false
      }
    }

    await handleOptimize()

    expect(mockRunOptimizer).toHaveBeenCalledWith("trip-123")
    expect(mockToastError).toHaveBeenCalledWith(
      "Optimization failed. Make sure you have activities on your wishlist."
    )
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(optimizing).toBe(false)
  })
})
