/**
 * Outstanding-arrangement detection, shared by the To Do screen, the nav badge,
 * the plan timeline (which paints unresolved items red) and the event modal.
 *
 * All logic lives here so those four surfaces can never disagree about whether
 * something still needs doing — a red event with no matching To Do row, or a
 * badge count that doesn't match the list, reads as a broken app.
 *
 * Pure module: no Prisma, no server imports, so client components can use it.
 */

export type TripTaskKind = "MAKE_RESERVATION" | "ADD_CONFIRMATION" | "MAKE_PAYMENT" | "CHECK_IN"

export const TRIP_TASK_KINDS: TripTaskKind[] = [
  "MAKE_RESERVATION",
  "ADD_CONFIRMATION",
  "MAKE_PAYMENT",
  "CHECK_IN",
]

export const TRIP_TASK_LABELS: Record<TripTaskKind, string> = {
  MAKE_RESERVATION: "Needs reservation",
  ADD_CONFIRMATION: "Confirmation or voucher missing",
  MAKE_PAYMENT: "Payment required",
  CHECK_IN: "Check in",
}

/** Lower sorts first in the To Do list. */
const KIND_ORDER: Record<TripTaskKind, number> = {
  CHECK_IN: 0, // time-boxed — the window closes
  MAKE_PAYMENT: 1, // money, often with a deadline
  MAKE_RESERVATION: 2,
  ADD_CONFIRMATION: 3,
}

/** How long before departure airline/operator check-in typically opens. */
export const CHECK_IN_WINDOW_HOURS = 24

export interface TaskReservation {
  confirmationNumber?: string | null
  reservationName?: string | null
  bookingUrl?: string | null
  status?: string | null
  price?: number | null
  balanceDue?: number | null
  /** ISO timestamp */
  balanceDueDate?: string | null
  /** ISO timestamp — when check-in opens, if known or supplied by the booking */
  checkInOpensAt?: string | null
  /** ISO timestamp — set once the user has checked in, which clears the task */
  checkInCompletedAt?: string | null
}

/**
 * One itinerary item, flattened to just what task detection needs. Callers build
 * these from Prisma rows; keeping the shape narrow means this module stays pure
 * and trivially testable.
 */
export interface TaskSubject {
  itineraryItemId: string
  title: string
  /** ItineraryItemType as a string, e.g. "ACTIVITY" | "MEAL" | "FLIGHT" | "TRANSPORT" */
  type: string
  /** yyyy-MM-dd */
  date: string
  startTime?: string | null
  /** The user explicitly flagged this as still needing to be booked. */
  needsReservation: boolean
  hasAttachments: boolean
  reservation?: TaskReservation | null
  /** ISO departure timestamp, for deriving a check-in window on travel legs. */
  departureTime?: string | null
}

export interface TripTask {
  kind: TripTaskKind
  itineraryItemId: string
  /** The event's own name, for display. */
  title: string
  label: string
  /** Short explanation of what specifically is missing. */
  detail: string
  /** ISO timestamp this becomes/became urgent, when one is knowable. */
  dueAt?: string | null
  date: string
  startTime?: string | null
}

/**
 * Proof that a booking actually exists: a confirmation number, or an uploaded
 * voucher/ticket. Either one remediates a "needs reservation" flag — the user
 * asked for exactly that, and a voucher with no reference number is still proof.
 *
 * A bookingUrl deliberately does NOT count: a link to where you *could* book is
 * not evidence you did.
 */
export function hasBookingProof(subject: TaskSubject): boolean {
  if (subject.hasAttachments) return true
  const confirmation = subject.reservation?.confirmationNumber?.trim()
  return Boolean(confirmation)
}

/**
 * Whether an item the user flagged is still outstanding. This is what paints the
 * event red on the plan; it clears itself as soon as proof is entered.
 */
export function isAwaitingReservation(subject: TaskSubject): boolean {
  return subject.needsReservation && !hasBookingProof(subject)
}

/** Cancelled bookings shouldn't nag about confirmations or payment. */
function isCancelled(subject: TaskSubject): boolean {
  return (subject.reservation?.status || "").toUpperCase() === "CANCELLED"
}

/**
 * When check-in opens: an explicitly stored window wins, otherwise derive it for
 * travel legs from departure. Returns null when there's nothing to go on — we
 * never invent a check-in for, say, a museum visit.
 */
export function resolveCheckInOpensAt(subject: TaskSubject): string | null {
  const stored = subject.reservation?.checkInOpensAt
  if (stored) return stored

  const supportsCheckIn = subject.type === "FLIGHT" || subject.type === "TRANSPORT"
  if (!supportsCheckIn || !subject.departureTime) return null

  const departure = new Date(subject.departureTime)
  if (Number.isNaN(departure.getTime())) return null
  return new Date(departure.getTime() - CHECK_IN_WINDOW_HOURS * 3600_000).toISOString()
}

function outstandingBalance(subject: TaskSubject): number | null {
  const due = subject.reservation?.balanceDue
  if (due != null && due > 0) return due
  return null
}

/** Every task outstanding for one item. An item can raise more than one. */
export function tasksForSubject(subject: TaskSubject, now: Date): TripTask[] {
  const tasks: TripTask[] = []
  const base = {
    itineraryItemId: subject.itineraryItemId,
    title: subject.title,
    date: subject.date,
    startTime: subject.startTime ?? null,
  }
  const cancelled = isCancelled(subject)

  // 1. Explicitly flagged as not yet booked.
  if (isAwaitingReservation(subject)) {
    tasks.push({
      ...base,
      kind: "MAKE_RESERVATION",
      label: TRIP_TASK_LABELS.MAKE_RESERVATION,
      detail: "You marked this as still needing to be booked.",
      dueAt: null,
    })
  }

  // 2. Booked, but there's no confirmation or voucher on file. Only applies once
  //    a reservation record exists — otherwise every unbooked activity would nag.
  if (
    !cancelled &&
    subject.reservation &&
    !subject.needsReservation &&
    !hasBookingProof(subject)
  ) {
    tasks.push({
      ...base,
      kind: "ADD_CONFIRMATION",
      label: TRIP_TASK_LABELS.ADD_CONFIRMATION,
      detail: "This is booked but has no confirmation number or voucher attached.",
      dueAt: null,
    })
  }

  // 3. A balance or a due date exists.
  if (!cancelled) {
    const balance = outstandingBalance(subject)
    const dueDate = subject.reservation?.balanceDueDate ?? null
    if (balance != null || dueDate) {
      tasks.push({
        ...base,
        kind: "MAKE_PAYMENT",
        label: TRIP_TASK_LABELS.MAKE_PAYMENT,
        detail: balance != null ? `Balance outstanding: ${balance}` : "A payment due date is set.",
        dueAt: dueDate,
      })
    }
  }

  // 4. Check-in window is open and hasn't been completed.
  if (!cancelled && !subject.reservation?.checkInCompletedAt) {
    const opensAt = resolveCheckInOpensAt(subject)
    if (opensAt) {
      const opens = new Date(opensAt)
      // Only surface it once the window has actually opened; a task you can't
      // action yet is noise.
      if (!Number.isNaN(opens.getTime()) && opens.getTime() <= now.getTime()) {
        tasks.push({
          ...base,
          kind: "CHECK_IN",
          label: TRIP_TASK_LABELS.CHECK_IN,
          detail: "Check-in is open for this booking.",
          dueAt: subject.departureTime ?? null,
        })
      }
    }
  }

  return tasks
}

/** All outstanding tasks for a trip, most urgent first. */
export function computeTripTasks(subjects: TaskSubject[], now: Date = new Date()): TripTask[] {
  const tasks = subjects.flatMap((s) => tasksForSubject(s, now))

  return tasks.sort((a, b) => {
    // Anything with a real deadline outranks anything without one.
    if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1
    if (a.dueAt && !b.dueAt) return -1
    if (!a.dueAt && b.dueAt) return 1
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    return (a.startTime || "").localeCompare(b.startTime || "")
  })
}

export function countTasksByKind(tasks: TripTask[]): Record<TripTaskKind, number> {
  const counts = { MAKE_RESERVATION: 0, ADD_CONFIRMATION: 0, MAKE_PAYMENT: 0, CHECK_IN: 0 }
  for (const t of tasks) counts[t.kind] += 1
  return counts
}
