import { describe, it, expect } from "vitest"
import {
  hasBookingProof,
  isAwaitingReservation,
  type TaskSubject,
} from "@/lib/trip-tasks"

/**
 * These lock down the exact rules the plan timeline paints red with
 * (`AWAITING_RESERVATION_COLOR` in itinerary/timeline-view.tsx) and that the
 * event modal uses to decide between "not booked yet" and "sorted".
 *
 * The user's requirement was that a flagged event "would be remediated once you
 * enter reservation or voucher information" — so proof clears the red state
 * while the stored flag survives, and removing the proof brings it back.
 */

function subject(overrides: Partial<TaskSubject> = {}): TaskSubject {
  return {
    itineraryItemId: "item-1",
    title: "Sunset boat tour",
    type: "ACTIVITY",
    date: "2026-08-12",
    startTime: "18:00",
    needsReservation: false,
    hasAttachments: false,
    reservation: null,
    ...overrides,
  }
}

describe("hasBookingProof", () => {
  it("counts an uploaded voucher as proof", () => {
    expect(hasBookingProof(subject({ hasAttachments: true }))).toBe(true)
  })

  it("counts a confirmation number as proof", () => {
    expect(
      hasBookingProof(subject({ reservation: { confirmationNumber: "AB12CD34" } }))
    ).toBe(true)
  })

  it("ignores a whitespace-only confirmation number", () => {
    expect(
      hasBookingProof(subject({ reservation: { confirmationNumber: "   " } }))
    ).toBe(false)
  })

  it("does not accept a booking link as proof of a booking", () => {
    expect(
      hasBookingProof(
        subject({ reservation: { bookingUrl: "https://opentable.com/r/somewhere" } })
      )
    ).toBe(false)
  })

  it("does not accept a bare reservation record with no reference", () => {
    expect(
      hasBookingProof(subject({ reservation: { status: "CONFIRMED", price: 120 } }))
    ).toBe(false)
  })
})

describe("isAwaitingReservation — what turns an event red", () => {
  it("is false for an event nobody flagged, however empty", () => {
    expect(isAwaitingReservation(subject())).toBe(false)
  })

  it("is true for a flagged event with no proof at all", () => {
    expect(isAwaitingReservation(subject({ needsReservation: true }))).toBe(true)
  })

  it("clears once a confirmation number is entered", () => {
    expect(
      isAwaitingReservation(
        subject({
          needsReservation: true,
          reservation: { confirmationNumber: "XYZ999" },
        })
      )
    ).toBe(false)
  })

  it("clears once a voucher is attached, with no reservation record at all", () => {
    expect(
      isAwaitingReservation(subject({ needsReservation: true, hasAttachments: true }))
    ).toBe(false)
  })

  it("stays red when the only 'proof' is a link to where you could book", () => {
    expect(
      isAwaitingReservation(
        subject({
          needsReservation: true,
          reservation: { bookingUrl: "https://viator.com/tour" },
        })
      )
    ).toBe(true)
  })

  it("goes red again if the proof is later removed, because the flag persists", () => {
    const flagged = subject({ needsReservation: true, hasAttachments: true })
    expect(isAwaitingReservation(flagged)).toBe(false)
    expect(isAwaitingReservation({ ...flagged, hasAttachments: false })).toBe(true)
  })
})
