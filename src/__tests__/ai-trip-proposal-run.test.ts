import { describe, it, expect, vi } from "vitest"
import type { AssistantTurn, ChatMessage } from "@/lib/ai/openrouter"
import type { ModelCaller, ModelRequest } from "@/lib/ai/tool-loop"
import { runTripProposal, type TripProposalDeps } from "@/lib/ai/trip-proposal"
import type { FlightQuery } from "@/lib/flights/types"

const usage = (p = 400, c = 120) => ({ promptTokens: p, completionTokens: c, totalTokens: p + c })

function toolTurn(list: Array<{ name: string; args: Record<string, unknown> }>): AssistantTurn {
  return {
    content: null,
    finishReason: "tool_calls",
    usage: usage(),
    toolCalls: list.map((c, i) => ({
      id: `${c.name}_${i}`,
      type: "function" as const,
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    })),
  }
}

function textTurn(content: string): AssistantTurn {
  return { content, toolCalls: [], finishReason: "stop", usage: usage() }
}

/** Every tool result in the transcript, parsed, in order. */
function toolResults(messages: ChatMessage[]): Array<{ id: string; body: Record<string, unknown> }> {
  return messages
    .filter((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool")
    .map((m) => ({ id: m.tool_call_id, body: JSON.parse(m.content) }))
}

function makeDeps() {
  const deps: TripProposalDeps = {
    resolveDestination: vi.fn(async (q: string) => ({
      name: q.includes("Porto") ? "Porto, Portugal" : "Lisbon, Portugal",
      lat: 38.72,
      lng: -9.14,
      placeId: q.includes("Porto") ? "pl_porto" : "pl_lisbon",
    })),
    searchFlights: vi.fn(async (q: FlightQuery) => ({
      searchId: `fs_${q.destination}`,
      fromCache: false,
      offers: [
        {
          offerId: `fo_${q.destination}_cheap`,
          totalPrice: q.destination === "OPO" ? 990 : 1180,
          currency: "USD",
          carrierCodes: ["TP"],
          stops: 1,
          durationMins: 680,
          bookingUrl: `https://book.example/${q.destination}`,
          summary: `TAP ${q.origin}→${q.destination}, 1 stop`,
        },
        {
          offerId: `fo_${q.destination}_fast`,
          totalPrice: 1650,
          currency: "USD",
          carrierCodes: ["DL"],
          stops: 0,
          durationMins: 490,
          bookingUrl: `https://book.example/${q.destination}/fast`,
          summary: `Delta ${q.origin}→${q.destination}, nonstop`,
        },
        // A 4th/5th offer would be dropped by the top-3 rule
        { offerId: "fo_x", totalPrice: 2000, currency: "USD", carrierCodes: ["UA"], stops: 2, durationMins: 900, bookingUrl: "u", summary: "s" },
        { offerId: "fo_y", totalPrice: 2100, currency: "USD", carrierCodes: ["UA"], stops: 2, durationMins: 900, bookingUrl: "u", summary: "s" },
      ],
    })),
    getFareCalendar: vi.fn(async () => ({ cheapest: [{ departDate: "2027-05-04", price: 1180 }] })),
    suggestActivities: vi.fn(async () => [
      { title: "Jerónimos Monastery", kind: "landmark", rating: 4.7, placeId: "act_1", lat: 38.7, lng: -9.2 },
      { title: "Time Out Market", kind: "food", rating: 4.5, placeId: "act_2" },
    ]),
    hotelLink: vi.fn(async (d: string) => `https://hotels.example/?q=${encodeURIComponent(d)}`),
  }
  return deps
}

/**
 * A scripted "planner" that behaves like a real model would: it walks the
 * phases in order and, for the final answer, copies searchId/offerId out of
 * the searchFlights tool results it was given.
 */
function makePlanner() {
  const requests: ModelRequest[] = []
  const callModel: ModelCaller = async (req) => {
    requests.push({ ...req, messages: [...req.messages] })
    const results = toolResults(req.messages)
    const phase = results.length

    if (phase === 0) return toolTurn([{ name: "resolveDestination", args: { query: "Lisbon, Portugal" } }])
    if (phase === 1) {
      return toolTurn([
        { name: "getFareCalendar", args: { origin: "dtw", destination: "lis", month: "2027-05" } },
        {
          name: "searchFlights",
          args: { origin: "dtw", destination: "lis", departDate: "2027-05-04", returnDate: "2027-05-14", adults: 2 },
        },
      ])
    }
    if (phase === 3) {
      return toolTurn([
        { name: "suggestActivities", args: { destination: "Lisbon, Portugal", lat: 38.72, lng: -9.14 } },
        { name: "findStays", args: { destination: "Lisbon", checkIn: "2027-05-04", checkOut: "2027-05-14", tier: "mid-range" } },
      ])
    }
    if (phase === 5) {
      return toolTurn([
        {
          name: "estimateBudget",
          args: { flightTotal: 1180, flightIsRetrieved: true, lodgingTotal: 1600, activityCostsPerAdult: [12, 30], nights: 10, travelers: 2, tier: "mid-range" },
        },
      ])
    }

    // Final: build the JSON from what the tools returned.
    const search = results.find((r) => r.id.startsWith("searchFlights"))!.body as {
      searchId: string
      offers: Array<{ offerId: string; totalPrice: number; bookingUrl: string; summary: string }>
    }
    const stays = results.find((r) => r.id.startsWith("findStays"))!.body as {
      estimateTotal: number
      perNight: number
      bookingUrl: string
    }
    const budget = results.find((r) => r.id.startsWith("estimateBudget"))!.body as { total: number }
    const [cheap, fast] = search.offers
    const activities = [
      { title: "Jerónimos Monastery", kind: "landmark", estCost: 12, placeId: "act_1", lat: 38.7, lng: -9.2 },
      { title: "Time Out Market", kind: "food", estCost: 30, placeId: "act_2" },
    ]
    const common = {
      destination: { name: "Lisbon, Portugal", lat: 38.72, lng: -9.14, placeId: "pl_lisbon", iata: "LIS" },
      origin: { name: "Detroit", iata: "DTW" },
      startDate: "2027-05-04",
      endDate: "2027-05-14",
      travelers: 2,
      lodging: { estimateTotal: stays.estimateTotal, perNight: stays.perNight, currency: "USD", source: "ESTIMATED", tier: "mid-range", bookingUrl: stays.bookingUrl },
      activities,
    }
    const proposal = {
      summary: "Two ways to do Lisbon in May.",
      variants: [
        {
          ...common,
          label: "Cheapest",
          flight: { offerSummary: cheap.summary, totalPrice: cheap.totalPrice, currency: "USD", bookingUrl: cheap.bookingUrl, searchId: search.searchId, offerId: cheap.offerId, source: "RETRIEVED" },
          total: { amount: budget.total, currency: "USD", source: "RETRIEVED" },
          rationale: ["Lowest fare in the window", "Lodging and daily spend are estimates"],
        },
        {
          ...common,
          label: "Fastest",
          flight: { offerSummary: fast.summary, totalPrice: fast.totalPrice, currency: "USD", bookingUrl: fast.bookingUrl, searchId: search.searchId, offerId: fast.offerId, source: "RETRIEVED" },
          total: { amount: budget.total + (fast.totalPrice - cheap.totalPrice), currency: "USD", source: "RETRIEVED" },
          rationale: ["Nonstop both ways", "Costs 470 more than the cheapest option"],
        },
      ],
    }
    return textTurn("```json\n" + JSON.stringify(proposal) + "\n```")
  }
  return { callModel, requests }
}

describe("runTripProposal (fake model + fake tools)", () => {
  it("drives the tool loop end to end and returns a validated proposal", async () => {
    const deps = makeDeps()
    const { callModel, requests } = makePlanner()
    const onUsage = vi.fn()

    const res = await runTripProposal({
      input: { idea: "Ten days in Portugal in May, two adults, mid-range" },
      deps,
      callModel,
      maxIterations: 12,
      maxTokens: 120_000,
      today: "2026-09-27",
      homeCity: "Detroit, MI",
      onUsage,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.iterations).toBe(5)
    expect(onUsage).toHaveBeenCalledTimes(5)
    expect(res.tokens.totalTokens).toBe(5 * 520)
    expect(res.loop.stopReason).toBe("final")

    // Prompt plumbing
    const sys = requests[0].messages[0]
    expect(sys.role).toBe("system")
    expect((sys as { content: string }).content).toContain("Today is 2026-09-27")
    expect((requests[0].messages[1] as { content: string }).content).toContain("Origin: Detroit, MI")
    expect(requests[0].tools.map((t) => t.function.name)).toContain("searchFlights")

    // Tool wiring: codes upper-cased, adults passed through, default currency applied
    expect(deps.searchFlights).toHaveBeenCalledTimes(1)
    const q = (deps.searchFlights as ReturnType<typeof vi.fn>).mock.calls[0][0] as FlightQuery
    expect(q).toMatchObject({ origin: "DTW", destination: "LIS", adults: 2, children: 0, cabin: "economy", currency: "USD", returnDate: "2027-05-14" })
    expect(deps.getFareCalendar).toHaveBeenCalledWith({ origin: "DTW", destination: "LIS", month: "2027-05", currency: "USD" })
    expect(deps.resolveDestination).toHaveBeenCalledWith("Lisbon, Portugal")
    expect(deps.hotelLink).toHaveBeenCalledWith("Lisbon", "2027-05-04", "2027-05-14")

    // The searchFlights tool result is capped at 3 offers, sorted by price
    const searchResult = toolResults(requests[2].messages).find((r) => r.id.startsWith("searchFlights"))!.body as {
      offers: Array<{ offerId: string }>
    }
    expect(searchResult.offers.map((o) => o.offerId)).toEqual(["fo_LIS_cheap", "fo_LIS_fast", "fo_x"])

    // Output: ids propagated, sources honest, two variants on a real axis
    const { proposal } = res
    expect(proposal.variants.map((v) => v.label)).toEqual(["Cheapest", "Fastest"])
    expect(proposal.variants[0].flight).toMatchObject({ searchId: "fs_LIS", offerId: "fo_LIS_cheap", totalPrice: 1180, source: "RETRIEVED" })
    expect(proposal.variants[1].flight).toMatchObject({ offerId: "fo_LIS_fast", totalPrice: 1650 })
    expect(proposal.variants[0].lodging).toMatchObject({ estimateTotal: 1600, perNight: 160, source: "ESTIMATED" })
    expect(proposal.variants[0].total.source).toBe("RETRIEVED")
    expect(proposal.variants[0].total.amount).toBe(1180 + 1600 + 84 + 90 * 2 * 10)
    expect(proposal.variants[0].activities).toHaveLength(2)
    expect(proposal.variants[0].rationale.length).toBeGreaterThan(0)
  })

  it("finalizes with tools disabled when the iteration cap is hit, and still validates", async () => {
    const deps = makeDeps()
    let calls = 0
    const callModel: ModelCaller = async (req) => {
      calls += 1
      if (req.toolChoice === "none") {
        return textTurn(
          JSON.stringify({
            variants: [
              {
                label: "Best value",
                destination: { name: "Lisbon, Portugal" },
                startDate: "2027-05-04",
                endDate: "2027-05-14",
                travelers: 2,
                flight: { offerSummary: "approx. fare", totalPrice: 1200, currency: "USD", bookingUrl: "https://www.google.com/travel/flights", source: "RETRIEVED" },
                lodging: { estimateTotal: 1600, perNight: 160 },
                activities: [],
                total: { amount: 4600, currency: "USD", source: "RETRIEVED" },
                rationale: ["Ran out of tool budget; everything is an estimate"],
              },
            ],
          })
        )
      }
      return toolTurn([{ name: "resolveDestination", args: { query: "Lisbon" } }])
    }

    const res = await runTripProposal({ input: { idea: "Lisbon in May" }, deps, callModel, maxIterations: 3, maxTokens: 1e9 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(calls).toBe(4) // 3 tool iterations + 1 finalize
    expect(res.loop.stopReason).toBe("max_iterations")
    // No persisted offer -> RETRIEVED claims are downgraded
    expect(res.proposal.variants[0].flight?.source).toBe("ESTIMATED")
    expect(res.proposal.variants[0].total.source).toBe("ESTIMATED")
  })

  it("returns ok=false with the validation error when the model output is not a proposal", async () => {
    const deps = makeDeps()
    const callModel: ModelCaller = async () => textTurn("Sorry, I cannot help with that.")
    const res = await runTripProposal({ input: { idea: "Somewhere warm" }, deps, callModel })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/no JSON/)
    expect(res.iterations).toBe(1)
  })

  it("returns ok=false when the model transport fails", async () => {
    const deps = makeDeps()
    const callModel: ModelCaller = async () => {
      throw new Error("OpenRouter API error 500")
    }
    const res = await runTripProposal({ input: { idea: "Somewhere warm" }, deps, callModel })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/500/)
    expect(res.loop.stopReason).toBe("error")
  })
})
