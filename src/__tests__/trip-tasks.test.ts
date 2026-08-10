import { describe, it, expect } from "vitest"
import {
  CHECK_IN_WINDOW_HOURS,
  computeTripTasks,
  countTasksByKind,
  hasBookingProof,
  isAwaitingReservation,
  resolveCheckInOpensAt,
  type TaskSubject,
  type TripTaskKind,
} from "@/lib/trip-tasks"

const NOW = new Date("2026-06-10T12:00:00.000Z")

function subject(overrides: Partial<TaskSubject> = {}): TaskSubject {
  return {
    itineraryItemId: "item-1",
    title: "Dinner at Le Bernardin",
    type: "MEAL",
    date: "2026-06-12",
    startTime: "19:00",
    needsReservation: false,
    hasAttachments: false,
    reservation: null,
    departureTime: null,
    ...overrides,
  }
}

function kinds(subjects: TaskSubject[], now: Date = NOW): TripTaskKind[] {
  return computeTripTasks(subjects, now).map((t) => t.kind)
}

/** ISO string `hours` before/after NOW. */
function offsetFromNow(hours: number): string {
  return new Date(NOW.getTime() + hours * 3600_000).toISOString()
}

describe("MAKE_RESERVATION", () => {
  it("raises a task when the user flagged the item and nothing proves a booking", () => {
    const tasks = computeTripTasks([subject({ needsReservation: true })], NOW)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].kind).toBe("MAKE_RESERVATION")
    expect(tasks[0].label).toBe("Needs reservation")
    expect(tasks[0].itineraryItemId).toBe("item-1")
    expect(tasks[0].dueAt).toBeNull()
  })

  it("is remediated by a confirmation number", () => {
    const s = subject({
      needsReservation: true,
      reservation: { confirmationNumber: "ABC123", status: "CONFIRMED" },
    })
    expect(hasBookingProof(s)).toBe(true)
    expect(isAwaitingReservation(s)).toBe(false)
    expect(kinds([s])).not.toContain("MAKE_RESERVATION")
  })

  it("is remediated by an uploaded voucher, with no confirmation number", () => {
    const s = subject({
      needsReservation: true,
      hasAttachments: true,
      reservation: { confirmationNumber: null, status: "CONFIRMED" },
    })
    expect(hasBookingProof(s)).toBe(true)
    expect(kinds([s])).not.toContain("MAKE_RESERVATION")
  })

  it("is not remediated by a blank confirmation number or a booking link alone", () => {
    const blank = subject({
      needsReservation: true,
      reservation: { confirmationNumber: "   ", bookingUrl: "https://opentable.com/x" },
    })
    expect(hasBookingProof(blank)).toBe(false)
    expect(kinds([blank])).toContain("MAKE_RESERVATION")
  })
})

describe("ADD_CONFIRMATION", () => {
  it("raises a task when a booking exists but has no confirmation or voucher", () => {
    const tasks = computeTripTasks([subject({ reservation: { status: "CONFIRMED" } })], NOW)
    expect(tasks.map((t) => t.kind)).toEqual(["ADD_CONFIRMATION"])
    expect(tasks[0].label).toBe("Confirmation or voucher missing")
  })

  it("does not nag items that have no reservation at all", () => {
    expect(kinds([subject()])).toEqual([])
  })

  it("does not double up with MAKE_RESERVATION on a flagged item", () => {
    const s = subject({ needsReservation: true, reservation: { status: "PENDING" } })
    expect(kinds([s])).toEqual(["MAKE_RESERVATION"])
  })

  it("clears once a confirmation number is entered", () => {
    const s = subject({ reservation: { status: "CONFIRMED", confirmationNumber: "XY-9" } })
    expect(kinds([s])).toEqual([])
  })

  it("clears once a voucher is attached", () => {
    const s = subject({ hasAttachments: true, reservation: { status: "CONFIRMED" } })
    expect(kinds([s])).toEqual([])
  })
})

describe("MAKE_PAYMENT", () => {
  it("raises a task when a balance is outstanding", () => {
    const tasks = computeTripTasks(
      [subject({ reservation: { status: "CONFIRMED", confirmationNumber: "A1", balanceDue: 250 } })],
      NOW
    )
    expect(tasks.map((t) => t.kind)).toEqual(["MAKE_PAYMENT"])
    expect(tasks[0].detail).toContain("250")
  })

  it("raises a task when only a due date exists", () => {
    const dueAt = "2026-06-11T00:00:00.000Z"
    const tasks = computeTripTasks(
      [
        subject({
          reservation: { status: "CONFIRMED", confirmationNumber: "A1", balanceDueDate: dueAt },
        }),
      ],
      NOW
    )
    expect(tasks.map((t) => t.kind)).toEqual(["MAKE_PAYMENT"])
    expect(tasks[0].dueAt).toBe(dueAt)
  })

  it("ignores a zero or fully-paid balance", () => {
    const s = subject({
      reservation: { status: "CONFIRMED", confirmationNumber: "A1", balanceDue: 0, price: 400 },
    })
    expect(kinds([s])).toEqual([])
  })
})

describe("CHECK_IN", () => {
  it("raises a task once an explicitly stored window has opened", () => {
    const s = subject({
      reservation: {
        status: "CONFIRMED",
        confirmationNumber: "A1",
        checkInOpensAt: offsetFromNow(-2),
      },
    })
    expect(kinds([s])).toEqual(["CHECK_IN"])
  })

  it("stays silent while the window has not opened yet", () => {
    const s = subject({
      reservation: {
        status: "CONFIRMED",
        confirmationNumber: "A1",
        checkInOpensAt: offsetFromNow(5),
      },
    })
    expect(kinds([s])).toEqual([])
  })

  it("derives the window from departure on a flight", () => {
    const departureTime = offsetFromNow(6)
    const s = subject({
      type: "FLIGHT",
      title: "DL 442 to Amsterdam",
      departureTime,
      reservation: { status: "CONFIRMED", confirmationNumber: "A1" },
    })
    expect(resolveCheckInOpensAt(s)).toBe(
      new Date(new Date(departureTime).getTime() - CHECK_IN_WINDOW_HOURS * 3600_000).toISOString()
    )
    const tasks = computeTripTasks([s], NOW)
    expect(tasks.map((t) => t.kind)).toEqual(["CHECK_IN"])
    expect(tasks[0].dueAt).toBe(departureTime)
  })

  it("does not derive a window for a departure that is still days away", () => {
    const s = subject({
      type: "TRANSPORT",
      departureTime: offsetFromNow(CHECK_IN_WINDOW_HOURS + 6),
      reservation: { status: "CONFIRMED", confirmationNumber: "A1" },
    })
    expect(kinds([s])).toEqual([])
  })

  it("never invents a check-in for a non-travel item", () => {
    const s = subject({
      type: "ACTIVITY",
      departureTime: offsetFromNow(-1),
      reservation: { status: "CONFIRMED", confirmationNumber: "A1" },
    })
    expect(resolveCheckInOpensAt(s)).toBeNull()
    expect(kinds([s])).toEqual([])
  })

  it("clears once the user has checked in", () => {
    const s = subject({
      type: "FLIGHT",
      departureTime: offsetFromNow(6),
      reservation: {
        status: "CONFIRMED",
        confirmationNumber: "A1",
        checkInCompletedAt: offsetFromNow(-1),
      },
    })
    expect(kinds([s])).toEqual([])
  })
})

describe("cancelled bookings", () => {
  it("suppresses confirmation, payment and check-in tasks", () => {
    const s = subject({
      type: "FLIGHT",
      departureTime: offsetFromNow(6),
      reservation: {
        status: "CANCELLED",
        confirmationNumber: null,
        balanceDue: 120,
        balanceDueDate: offsetFromNow(24),
        checkInOpensAt: offsetFromNow(-2),
      },
    })
    expect(kinds([s])).toEqual([])
  })

  it("matches the status case-insensitively", () => {
    const s = subject({ reservation: { status: "cancelled" } })
    expect(kinds([s])).toEqual([])
  })
})

describe("computeTripTasks ordering and counting", () => {
  const flight = subject({
    itineraryItemId: "flight-1",
    title: "DL 442",
    type: "FLIGHT",
    date: "2026-06-11",
    startTime: "08:00",
    departureTime: offsetFromNow(6),
    reservation: { status: "CONFIRMED", confirmationNumber: "A1" },
  })
  const payment = subject({
    itineraryItemId: "hotel-1",
    title: "Hotel balance",
    type: "HOTEL_CHECK_IN",
    date: "2026-06-12",
    startTime: "15:00",
    reservation: {
      status: "CONFIRMED",
      confirmationNumber: "B2",
      balanceDue: 300,
      balanceDueDate: offsetFromNow(2),
    },
  })
  const unbooked = subject({ itineraryItemId: "meal-1", needsReservation: true })
  const missingConfirmation = subject({
    itineraryItemId: "tour-1",
    title: "Canal tour",
    type: "ACTIVITY",
    reservation: { status: "CONFIRMED" },
  })

  it("puts dated deadlines first, then check-in, payment, reservation, confirmation", () => {
    const tasks = computeTripTasks(
      [missingConfirmation, unbooked, flight, payment],
      NOW
    )
    expect(tasks.map((t) => t.kind)).toEqual([
      "MAKE_PAYMENT", // due in 2h
      "CHECK_IN", // due at departure, 6h out
      "MAKE_RESERVATION",
      "ADD_CONFIRMATION",
    ])
  })

  it("counts by kind", () => {
    const tasks = computeTripTasks([missingConfirmation, unbooked, flight, payment], NOW)
    expect(countTasksByKind(tasks)).toEqual({
      MAKE_RESERVATION: 1,
      ADD_CONFIRMATION: 1,
      MAKE_PAYMENT: 1,
      CHECK_IN: 1,
    })
    expect(tasks).toHaveLength(4)
  })

  it("lets one item raise more than one task", () => {
    const s = subject({
      type: "FLIGHT",
      departureTime: offsetFromNow(3),
      reservation: { status: "CONFIRMED", balanceDue: 75 },
    })
    expect(kinds([s]).sort()).toEqual(["ADD_CONFIRMATION", "CHECK_IN", "MAKE_PAYMENT"])
  })

  it("returns nothing for a fully-organised trip", () => {
    expect(computeTripTasks([], NOW)).toEqual([])
    expect(countTasksByKind([])).toEqual({
      MAKE_RESERVATION: 0,
      ADD_CONFIRMATION: 0,
      MAKE_PAYMENT: 0,
      CHECK_IN: 0,
    })
  })
})
