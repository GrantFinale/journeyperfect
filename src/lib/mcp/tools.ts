import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireTripAccessForUser } from "@/lib/auth-trip"
import { getPlanLimits, type Plan } from "@/lib/plans"
import { computeTripTasks, type TaskSubject } from "@/lib/trip-tasks"
import { createFlightWithItinerary } from "@/lib/flight-records"
import type { McpCallContext, McpToolDefinition, McpToolRegistry, McpToolResult } from "./server"

/**
 * Tool handlers for the MCP server. Every handler is scoped to the
 * authenticated `userId` and re-checks trip ownership / collaboration through
 * `requireTripAccessForUser`, exactly as the server actions do with a session.
 *
 * Handlers throw `McpToolError` for anything the agent should be told about
 * (bad input, no access, plan limit). Anything else is logged and reported as
 * a generic failure: no messages from Prisma, no stack traces.
 */
export class McpToolError extends Error {}

// ─── Shared helpers ─────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD` only; itinerary dates are calendar days, not instants. */
const dateOnly = z
  .string()
  .regex(DATE_RE, "expected YYYY-MM-DD")
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), "not a real calendar date")

/** Any ISO 8601 date-time `new Date()` accepts. */
const dateTime = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), "expected an ISO 8601 date-time")

const tripIdArg = z.string().min(1, "tripId is required")

/** `@db.Date` columns come back as UTC midnight; slice the ISO string for the day. */
function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function text(value: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }
}

function errorResult(message: string): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true }
}

async function requireAccess(userId: string, tripId: string, role: "VIEWER" | "EDITOR" = "VIEWER") {
  try {
    return await requireTripAccessForUser(userId, tripId, role)
  } catch (err) {
    // The two messages requireTripAccess produces are both safe to relay.
    throw new McpToolError(err instanceof Error ? err.message : "Trip not found")
  }
}

function tripSummary(trip: {
  id: string
  title: string
  destination: string
  startDate: Date
  endDate: Date
  status: string
  originLabel: string | null
  originAddress: string | null
}) {
  return {
    id: trip.id,
    title: trip.title,
    destination: trip.destination,
    startDate: dateKey(trip.startDate),
    endDate: dateKey(trip.endDate),
    status: trip.status,
    origin: trip.originLabel || trip.originAddress ? { label: trip.originLabel, address: trip.originAddress } : null,
  }
}

// ─── Tool definitions ───────────────────────────────────────────────────────

type Handler<TArgs> = (args: TArgs, ctx: McpCallContext) => Promise<unknown>

interface ToolSpec<TSchema extends z.ZodTypeAny> {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  schema: TSchema
  handler: Handler<z.output<TSchema>>
}

function tool<TSchema extends z.ZodTypeAny>(spec: ToolSpec<TSchema>): ToolSpec<TSchema> {
  return spec
}

const listTrips = tool({
  name: "list_trips",
  description:
    "List the trips this user owns or collaborates on, soonest first. Returns ids to use with the other tools.",
  inputSchema: {
    type: "object",
    properties: {
      includePast: {
        type: "boolean",
        description: "Include trips whose end date has passed. Default false.",
      },
    },
    additionalProperties: false,
  },
  schema: z.object({ includePast: z.boolean().optional() }),
  handler: async ({ includePast }, { userId }) => {
    const trips = await prisma.trip.findMany({
      where: {
        OR: [{ userId }, { collaborators: { some: { userId, status: "ACCEPTED" } } }],
        ...(includePast ? {} : { endDate: { gte: new Date(new Date().toISOString().slice(0, 10)) } }),
      },
      include: {
        destinations: { orderBy: { position: "asc" }, select: { name: true } },
        collaborators: { where: { userId }, select: { role: true } },
      },
      orderBy: { startDate: "asc" },
      take: 100,
    })
    return {
      trips: trips.map((t) => ({
        ...tripSummary(t),
        destinations: t.destinations.map((d) => d.name),
        role: t.userId === userId ? "OWNER" : t.collaborators[0]?.role ?? "VIEWER",
      })),
    }
  },
})

const getTrip = tool({
  name: "get_trip",
  description: "Get one trip: summary, ordered destinations, travellers, and counts of flights, hotels and activities.",
  inputSchema: {
    type: "object",
    properties: { tripId: { type: "string", description: "Trip id from list_trips." } },
    required: ["tripId"],
    additionalProperties: false,
  },
  schema: z.object({ tripId: tripIdArg }),
  handler: async ({ tripId }, { userId }) => {
    const { role } = await requireAccess(userId, tripId)
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        destinations: { orderBy: { position: "asc" } },
        travelers: { include: { traveler: { select: { id: true, name: true, tags: true } } } },
        _count: { select: { flights: true, hotels: true, activities: true, itineraryItems: true, rentalCars: true } },
      },
    })
    if (!trip) throw new McpToolError("Trip not found")
    return {
      ...tripSummary(trip),
      role,
      notes: trip.notes,
      destinations: trip.destinations.map((d) => ({ id: d.id, name: d.name, lat: d.lat, lng: d.lng })),
      travelers: trip.travelers.map((t) => ({
        id: t.traveler.id,
        name: t.traveler.name,
        isPrimary: t.isPrimary,
        tags: t.traveler.tags,
      })),
      counts: trip._count,
    }
  },
})

const createTrip = tool({
  name: "create_trip",
  description:
    "Create a new trip owned by this user. The trip starts empty; add flights, reservations and activities with the other tools.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Trip title, e.g. \"Portugal in May\"." },
      destination: { type: "string", description: "Primary destination, e.g. \"Lisbon, Portugal\"." },
      startDate: { type: "string", description: "First day, YYYY-MM-DD." },
      endDate: { type: "string", description: "Last day, YYYY-MM-DD." },
      originLabel: {
        type: "string",
        description: "Optional label for where the trip starts, e.g. \"Home\". Defaults to the user's saved home.",
      },
    },
    required: ["title", "destination", "startDate", "endDate"],
    additionalProperties: false,
  },
  schema: z
    .object({
      title: z.string().min(1).max(100),
      destination: z.string().min(1).max(200),
      startDate: dateOnly,
      endDate: dateOnly,
      originLabel: z.string().max(100).optional(),
    })
    .refine((v) => v.endDate >= v.startDate, { message: "endDate must not be before startDate", path: ["endDate"] }),
  handler: async (args, { userId }) => {
    // Mirrors `createTrip` in src/lib/actions/trips.ts: plan limit, then
    // origin prefilled from the saved home address when none is supplied.
    const [tripCount, user] = await Promise.all([
      prisma.trip.count({ where: { userId } }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { plan: true, homeAddress: true, homeCity: true, homeLat: true, homeLng: true },
      }),
    ])
    const limits = getPlanLimits((user?.plan as Plan) ?? "FREE")
    if (tripCount >= limits.maxTrips) {
      throw new McpToolError(`Plan limit reached: this account can hold ${limits.maxTrips} trips. Upgrade to add more.`)
    }

    const origin = args.originLabel
      ? { originLabel: args.originLabel, originAddress: null, originLat: null, originLng: null }
      : {
          originLabel: user?.homeAddress || user?.homeCity ? "Home" : null,
          originAddress: user?.homeAddress ?? user?.homeCity ?? null,
          originLat: user?.homeLat ?? null,
          originLng: user?.homeLng ?? null,
        }

    const trip = await prisma.trip.create({
      data: {
        userId,
        title: args.title,
        destination: args.destination,
        startDate: new Date(args.startDate),
        endDate: new Date(args.endDate),
        ...origin,
        destinations: { create: [{ name: args.destination, position: 0 }] },
      },
    })
    return { trip: tripSummary(trip) }
  },
})

const getItinerary = tool({
  name: "get_itinerary",
  description:
    "List the trip's itinerary items in day order, with any linked flight and reservation. Optionally filter to one day.",
  inputSchema: {
    type: "object",
    properties: {
      tripId: { type: "string" },
      date: { type: "string", description: "Optional YYYY-MM-DD to return a single day." },
    },
    required: ["tripId"],
    additionalProperties: false,
  },
  schema: z.object({ tripId: tripIdArg, date: dateOnly.optional() }),
  handler: async ({ tripId, date }, { userId }) => {
    await requireAccess(userId, tripId)
    const items = await prisma.itineraryItem.findMany({
      where: { tripId, ...(date ? { date: new Date(`${date}T00:00:00Z`) } : {}) },
      include: {
        reservation: true,
        flight: {
          select: {
            id: true,
            airline: true,
            flightNumber: true,
            departureAirport: true,
            arrivalAirport: true,
            departureTime: true,
            arrivalTime: true,
            confirmationNumber: true,
          },
        },
        activity: { select: { id: true, name: true, category: true, address: true } },
        hotel: { select: { id: true, name: true, address: true, confirmationNumber: true } },
      },
      orderBy: [{ date: "asc" }, { position: "asc" }, { startTime: "asc" }],
    })
    return {
      items: items.map((item) => ({
        id: item.id,
        date: dateKey(item.date),
        startTime: item.startTime,
        endTime: item.endTime,
        type: item.type,
        title: item.title,
        notes: item.notes,
        durationMins: item.durationMins,
        isConfirmed: item.isConfirmed,
        needsReservation: item.needsReservation,
        flight: item.flight
          ? { ...item.flight, departureTime: iso(item.flight.departureTime), arrivalTime: iso(item.flight.arrivalTime) }
          : null,
        activity: item.activity,
        hotel: item.hotel,
        reservation: item.reservation
          ? {
              id: item.reservation.id,
              confirmationNumber: item.reservation.confirmationNumber,
              provider: item.reservation.provider,
              bookingUrl: item.reservation.bookingUrl,
              status: item.reservation.status,
              price: item.reservation.price,
              currency: item.reservation.currency,
              partySize: item.reservation.partySize,
              checkInOpensAt: iso(item.reservation.checkInOpensAt),
              checkInCompletedAt: iso(item.reservation.checkInCompletedAt),
            }
          : null,
      })),
    }
  },
})

const addFlight = tool({
  name: "add_flight",
  description:
    "Add a booked flight to a trip. Creates the flight, a FLIGHT itinerary item on the departure day, and a budget line " +
    "when a price is given. Times are ISO 8601; include an offset (e.g. 2026-05-02T09:15:00-04:00) or pass timezones.",
  inputSchema: {
    type: "object",
    properties: {
      tripId: { type: "string" },
      airline: { type: "string", description: "Airline name or code, e.g. \"TAP\"." },
      flightNumber: { type: "string", description: "e.g. \"TP 208\"." },
      departureAirport: { type: "string", description: "IATA code, e.g. \"JFK\"." },
      departureTime: { type: "string", description: "ISO 8601 date-time of departure." },
      departureTimezone: { type: "string", description: "IANA zone of the departure airport, e.g. \"America/New_York\". Default UTC." },
      arrivalAirport: { type: "string", description: "IATA code, e.g. \"LIS\"." },
      arrivalTime: { type: "string", description: "ISO 8601 date-time of arrival." },
      arrivalTimezone: { type: "string", description: "IANA zone of the arrival airport. Default UTC." },
      confirmationNumber: { type: "string", description: "Airline record locator / PNR." },
      price: { type: "number", description: "Total paid." },
      priceCurrency: { type: "string", description: "ISO 4217 code. Default USD." },
      cabin: { type: "string", description: "e.g. \"economy\", \"business\"." },
      bookingLink: { type: "string", description: "URL to manage the booking." },
    },
    required: ["tripId", "airline", "flightNumber", "departureAirport", "departureTime", "arrivalAirport", "arrivalTime"],
    additionalProperties: false,
  },
  schema: z
    .object({
      tripId: tripIdArg,
      airline: z.string().min(1).max(200),
      flightNumber: z.string().min(1).max(200),
      departureAirport: z.string().min(1).max(200),
      departureTime: dateTime,
      departureTimezone: z.string().max(200).optional(),
      arrivalAirport: z.string().min(1).max(200),
      arrivalTime: dateTime,
      arrivalTimezone: z.string().max(200).optional(),
      confirmationNumber: z.string().max(200).optional(),
      price: z.number().nonnegative().optional(),
      priceCurrency: z.string().length(3).optional(),
      cabin: z.string().max(200).optional(),
      bookingLink: z.string().max(2048).url().optional(),
    })
    .refine((v) => new Date(v.arrivalTime) > new Date(v.departureTime), {
      message: "arrivalTime must be after departureTime",
      path: ["arrivalTime"],
    }),
  handler: async ({ tripId, ...flight }, { userId }) => {
    await requireAccess(userId, tripId, "EDITOR")
    const { flight: created, itineraryItem } = await createFlightWithItinerary(tripId, flight)
    return {
      flight: {
        id: created.id,
        airline: created.airline,
        flightNumber: created.flightNumber,
        departureAirport: created.departureAirport,
        departureTime: iso(created.departureTime),
        arrivalAirport: created.arrivalAirport,
        arrivalTime: iso(created.arrivalTime),
        confirmationNumber: created.confirmationNumber,
      },
      itineraryItem: { id: itineraryItem.id, date: dateKey(itineraryItem.date), title: itineraryItem.title },
    }
  },
})

const addReservation = tool({
  name: "add_reservation",
  description:
    "Attach or update booking details on an itinerary item (a dinner, tour, hotel night, flight). A confirmation number " +
    "clears the item's \"needs reservation\" task.",
  inputSchema: {
    type: "object",
    properties: {
      tripId: { type: "string" },
      itineraryItemId: { type: "string", description: "Item id from get_itinerary." },
      confirmationNumber: { type: "string" },
      provider: { type: "string", description: "Who the booking was made through, e.g. \"OpenTable\"." },
      bookingUrl: { type: "string", description: "URL to view or manage the booking." },
      price: { type: "number" },
      currency: { type: "string", description: "ISO 4217 code. Default USD." },
      partySize: { type: "integer" },
      notes: { type: "string" },
    },
    required: ["tripId", "itineraryItemId"],
    additionalProperties: false,
  },
  schema: z.object({
    tripId: tripIdArg,
    itineraryItemId: z.string().min(1).max(200),
    confirmationNumber: z.string().max(200).optional(),
    provider: z.string().max(200).optional(),
    bookingUrl: z.string().max(2048).url().optional(),
    price: z.number().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    partySize: z.number().int().positive().optional(),
    notes: z.string().max(5000).optional(),
  }),
  handler: async ({ tripId, itineraryItemId, ...fields }, { userId }) => {
    await requireAccess(userId, tripId, "EDITOR")
    // Reservation ids are not trip-scoped, so prove the item is in this trip
    // before touching its booking (same rule as actions/reservations.ts).
    const item = await prisma.itineraryItem.findFirst({ where: { id: itineraryItemId, tripId }, select: { id: true } })
    if (!item) throw new McpToolError("Itinerary item not found in this trip")

    // Prisma leaves `undefined` keys untouched, so the update half is a merge.
    const reservation = await prisma.reservation.upsert({
      where: { itineraryItemId },
      create: { itineraryItemId, ...fields, currency: fields.currency ?? "USD" },
      update: fields,
    })
    return {
      reservation: {
        id: reservation.id,
        itineraryItemId: reservation.itineraryItemId,
        confirmationNumber: reservation.confirmationNumber,
        provider: reservation.provider,
        bookingUrl: reservation.bookingUrl,
        price: reservation.price,
        currency: reservation.currency,
        partySize: reservation.partySize,
        status: reservation.status,
      },
    }
  },
})

const listOutstandingTasks = tool({
  name: "list_outstanding_tasks",
  description:
    "Everything still to do on a trip, most urgent first: reservations to make, confirmation numbers to add, balances to pay, check-ins that are open.",
  inputSchema: {
    type: "object",
    properties: { tripId: { type: "string" } },
    required: ["tripId"],
    additionalProperties: false,
  },
  schema: z.object({ tripId: tripIdArg }),
  handler: async ({ tripId }, { userId }) => {
    await requireAccess(userId, tripId)
    // Same subject query as `loadTaskSubjects` in src/lib/actions/trip-tasks.ts
    // (that one is session-bound and React-cached); the rules live in
    // `computeTripTasks`, which both share. Attachments are counted, never
    // selected: `EventAttachment.data` is the uploaded file itself.
    const items = await prisma.itineraryItem.findMany({
      where: { tripId },
      select: {
        id: true,
        title: true,
        type: true,
        date: true,
        startTime: true,
        needsReservation: true,
        reservation: {
          select: {
            confirmationNumber: true,
            reservationName: true,
            bookingUrl: true,
            status: true,
            price: true,
            balanceDue: true,
            balanceDueDate: true,
            checkInOpensAt: true,
            checkInCompletedAt: true,
          },
        },
        flight: { select: { departureTime: true } },
        transportSegment: { select: { departureTime: true } },
        _count: { select: { attachments: true } },
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    })
    const subjects: TaskSubject[] = items.map((item) => ({
      itineraryItemId: item.id,
      title: item.title,
      type: item.type,
      date: dateKey(item.date),
      startTime: item.startTime,
      needsReservation: item.needsReservation,
      hasAttachments: item._count.attachments > 0,
      reservation: item.reservation
        ? {
            ...item.reservation,
            balanceDueDate: iso(item.reservation.balanceDueDate),
            checkInOpensAt: iso(item.reservation.checkInOpensAt),
            checkInCompletedAt: iso(item.reservation.checkInCompletedAt),
          }
        : null,
      departureTime: iso(item.flight?.departureTime ?? item.transportSegment?.departureTime),
    }))
    const tasks = computeTripTasks(subjects, new Date())
    return { count: tasks.length, tasks }
  },
})

const addActivity = tool({
  name: "add_activity",
  description:
    "Add an idea to the trip's wishlist (a museum, restaurant, hike). It is not scheduled until the user places it on a day; " +
    "pass `date` to pin it to a specific day.",
  inputSchema: {
    type: "object",
    properties: {
      tripId: { type: "string" },
      name: { type: "string" },
      category: { type: "string", description: "e.g. \"museum\", \"restaurant\", \"beach\", \"attraction\"." },
      date: { type: "string", description: "Optional YYYY-MM-DD to pin the activity to a day." },
      notes: { type: "string" },
    },
    required: ["tripId", "name"],
    additionalProperties: false,
  },
  schema: z.object({
    tripId: tripIdArg,
    name: z.string().min(1).max(200),
    category: z.string().max(60).optional(),
    date: dateOnly.optional(),
    notes: z.string().max(5000).optional(),
  }),
  handler: async ({ tripId, name, category, date, notes }, { userId }) => {
    await requireAccess(userId, tripId, "EDITOR")
    const activity = await prisma.activity.create({
      data: {
        tripId,
        name,
        category,
        notes,
        status: "WISHLIST",
        ...(date ? { isFixed: true, fixedDateTime: new Date(`${date}T00:00:00Z`) } : {}),
      },
    })
    return {
      activity: {
        id: activity.id,
        name: activity.name,
        category: activity.category,
        status: activity.status,
        pinnedDate: activity.fixedDateTime ? dateKey(activity.fixedDateTime) : null,
        notes: activity.notes,
      },
    }
  },
})

// ─── Registry ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SPECS: ToolSpec<any>[] = [
  listTrips,
  getTrip,
  createTrip,
  getItinerary,
  addFlight,
  addReservation,
  listOutstandingTasks,
  addActivity,
]

const BY_NAME = new Map(SPECS.map((s) => [s.name, s]))

export const TOOL_DEFINITIONS: McpToolDefinition[] = SPECS.map(({ name, description, inputSchema }) => ({
  name,
  description,
  inputSchema,
}))

export const TOOL_NAMES = SPECS.map((s) => s.name)

export async function callTool(name: string, args: unknown, ctx: McpCallContext): Promise<McpToolResult> {
  const spec = BY_NAME.get(name)
  if (!spec) return errorResult(`Unknown tool: ${name}`)

  const parsed = spec.schema.safeParse(args)
  if (!parsed.success) {
    const issues = (parsed.error as z.ZodError).issues.map(
      (i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`
    )
    return errorResult(`Invalid arguments: ${issues.join("; ")}`)
  }

  try {
    return text(await spec.handler(parsed.data, ctx))
  } catch (err) {
    if (err instanceof McpToolError) return errorResult(err.message)
    console.error(`[mcp] ${name} failed:`, err)
    return errorResult(`${name} failed. Nothing was changed if this was a write; try again or check the trip in JourneyPerfect.`)
  }
}

export const toolRegistry: McpToolRegistry = {
  list: () => TOOL_DEFINITIONS,
  has: (name) => BY_NAME.has(name),
  call: callTool,
}
