"use client"

import Link from "next/link"
import { format } from "date-fns"
import {
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileWarning,
  PlaneTakeoff,
} from "lucide-react"
import { TRIP_TASK_LABELS, type TripTask, type TripTaskKind } from "@/lib/trip-tasks"
import { formatTime } from "@/lib/utils"

const KIND_ICON: Record<TripTaskKind, typeof CalendarPlus> = {
  CHECK_IN: PlaneTakeoff,
  MAKE_PAYMENT: CreditCard,
  MAKE_RESERVATION: CalendarPlus,
  ADD_CONFIRMATION: FileWarning,
}

/** One-line hint about what to do, under the group heading. */
const KIND_HINT: Record<TripTaskKind, string> = {
  CHECK_IN: "Check-in is open — do it before the window closes.",
  MAKE_PAYMENT: "A balance is still owed on these bookings.",
  MAKE_RESERVATION: "You flagged these as still needing to be booked.",
  ADD_CONFIRMATION: "Add the confirmation number or attach the voucher.",
}

/**
 * `task.date` is a plain yyyy-MM-dd calendar day. Parsing it with `new Date()`
 * would read it as UTC midnight and shift it back a day in western timezones,
 * so build the date in local time instead.
 */
function formatTaskDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  if (!year || !month || !day) return date
  return format(new Date(year, month - 1, day), "EEE, MMM d")
}

function formatDueAt(dueAt: string): string | null {
  const parsed = new Date(dueAt)
  if (Number.isNaN(parsed.getTime())) return null
  return format(parsed, "MMM d, h:mm a")
}

interface TodoViewProps {
  tripId: string
  tasks: TripTask[]
}

export function TodoView({ tripId, tasks }: TodoViewProps) {
  // Keep the order computeTripTasks already put them in — check-in and payment
  // carry real deadlines, so they surface first.
  const groups: { kind: TripTaskKind; tasks: TripTask[] }[] = []
  for (const task of tasks) {
    const existing = groups.find((g) => g.kind === task.kind)
    if (existing) existing.tasks.push(task)
    else groups.push({ kind: task.kind, tasks: [task] })
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold text-foreground">To Do</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {tasks.length === 0
            ? "Everything on this trip is squared away."
            : `${tasks.length} ${tasks.length === 1 ? "thing" : "things"} still need${
                tasks.length === 1 ? "s" : ""
              } your attention.`}
        </p>
      </header>

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
          <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-600" aria-hidden="true" />
          <h2 className="mt-3 text-base font-medium text-foreground">Nothing outstanding</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every booking has a confirmation, nothing is awaiting payment, and no check-in is open.
          </p>
          <Link
            href={`/trip/${tripId}/itinerary`}
            className="inline-flex items-center gap-1 mt-4 text-sm font-medium text-primary hover:underline"
          >
            Back to the plan
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => {
            const Icon = KIND_ICON[group.kind]
            return (
              <section key={group.kind}>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Icon className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-foreground">
                    {TRIP_TASK_LABELS[group.kind]}
                  </h2>
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">
                    {group.tasks.length}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-2 px-1">{KIND_HINT[group.kind]}</p>

                <ul className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                  {group.tasks.map((task) => {
                    const due = task.dueAt ? formatDueAt(task.dueAt) : null
                    return (
                      <li key={`${task.kind}-${task.itineraryItemId}`}>
                        <Link
                          href={`/trip/${tripId}/itinerary?item=${task.itineraryItemId}`}
                          className="flex items-start gap-3 px-4 py-3 hover:bg-accent transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {task.title}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatTaskDate(task.date)}
                              {task.startTime ? ` · ${formatTime(task.startTime)}` : ""}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">{task.detail}</p>
                            {due && (
                              <p className="text-xs font-medium text-red-600 mt-1">Due {due}</p>
                            )}
                          </div>
                          <ChevronRight
                            className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5"
                            aria-hidden="true"
                          />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
