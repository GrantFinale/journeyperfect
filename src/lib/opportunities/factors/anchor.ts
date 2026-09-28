/**
 * Anchor experience (stage 1, free). Plan §4.5: the profile's seasonal
 * anchors for the stay's months, plus an optional dated events list (from
 * events.ts / Ticketmaster) for the exact dates. One qualifying anchor can
 * carry a destination on its own (plan §5). Pure.
 *
 * Source: RETRIEVED when a dated event on the exact dates is the anchor,
 * ESTIMATED when the anchor is editorial knowledge from the profile.
 */
import type { ProfileAnchor } from "../destinations"
import { daysBetween, monthsInRange } from "../dates"
import type { AnchorKind, FactorResult, OpportunityAnchorExperience, OpportunityReason } from "../types"
import { reason, result, unavailable } from "./shared"

export interface EventSummary {
  title: string
  kind: "SPORTS" | "CONCERT" | "FESTIVAL" | "EVENT"
  /** YYYY-MM-DD */
  date: string
  url?: string
  venue?: string
}

export interface AnchorInput {
  anchors: ProfileAnchor[]
  /** YYYY-MM-DD */
  checkIn: string
  /** YYYY-MM-DD */
  checkOut: string
  events?: EventSummary[] | null
  destinationName: string
  /** ISO 8601 when events were fetched */
  eventsRetrievedAt?: string
}

const EVENT_KIND_TO_ANCHOR: Record<EventSummary["kind"], AnchorKind> = {
  SPORTS: "SPORTS",
  CONCERT: "EVENT",
  FESTIVAL: "FESTIVAL",
  EVENT: "EVENT",
}

/** An anchor that runs fewer than 12 months is "in season" knowledge, not a fixture. */
export function isSeasonal(a: ProfileAnchor): boolean {
  return a.months.length < 12
}

export function anchorsForStay(anchors: readonly ProfileAnchor[], checkIn: string, checkOut: string): ProfileAnchor[] {
  const months = monthsInRange(checkIn, checkOut)
  return anchors.filter((a) => a.months.some((m) => months.includes(m)))
}

export function eventsDuringStay(events: readonly EventSummary[], checkIn: string, checkOut: string): EventSummary[] {
  return events.filter((e) => {
    try {
      return daysBetween(checkIn, e.date) >= 0 && daysBetween(e.date, checkOut) >= 0
    } catch {
      return false
    }
  })
}

export function evaluateAnchor(input: AnchorInput): FactorResult {
  const inSeason = anchorsForStay(input.anchors, input.checkIn, input.checkOut)
  const events = eventsDuringStay(input.events ?? [], input.checkIn, input.checkOut)

  if (inSeason.length === 0 && events.length === 0) {
    if (input.anchors.length === 0 && !input.events) return unavailable("anchor")
    return result("anchor", 0.1, "ESTIMATED", { anchorCount: 0, eventCount: 0, weatherDependent: false }, [])
  }

  const seasonal = inSeason.filter(isSeasonal)
  const yearRound = inSeason.filter((a) => !isSeasonal(a))

  // Primary anchor: a dated event on these exact dates beats seasonal
  // knowledge, which beats a year-round fixture.
  let primary: OpportunityAnchorExperience
  let score: number
  const reasons: OpportunityReason[] = []

  if (events.length > 0) {
    const e = events[0]
    primary = { title: e.title, kind: EVENT_KIND_TO_ANCHOR[e.kind], date: e.date, source: "RETRIEVED" }
    if (e.url) primary.url = e.url
    score = 0.9
    reasons.push(
      reason(
        "anchor",
        "POSITIVE",
        `${e.title} is on these dates`,
        0.85,
        [e.date, e.venue].filter(Boolean).join(" · ")
      )
    )
  } else if (seasonal.length > 0) {
    const a = seasonal[0]
    primary = { title: a.title, kind: a.kind, source: "ESTIMATED" }
    score = 0.75
    reasons.push(reason("anchor", "POSITIVE", `${a.title} is in season`, 0.65, input.destinationName))
  } else {
    const a = yearRound[0]
    primary = { title: a.title, kind: a.kind, source: "ESTIMATED" }
    score = yearRound.length >= 2 ? 0.5 : 0.45
  }

  const weatherDependent =
    events.length > 0
      ? false
      : (seasonal[0] ?? yearRound[0])?.weatherDependent === true

  return result(
    "anchor",
    score,
    events.length > 0 ? "RETRIEVED" : "ESTIMATED",
    {
      anchorTitle: primary.title,
      anchorKind: primary.kind,
      anchorRawKind: events.length > 0 ? events[0].kind : (seasonal[0] ?? yearRound[0]).rawKind,
      anchorDate: primary.date ?? "",
      anchorUrl: primary.url ?? "",
      anchorSource: primary.source,
      anchorCount: inSeason.length,
      seasonalCount: seasonal.length,
      eventCount: events.length,
      weatherDependent,
    },
    reasons,
    events.length > 0 ? input.eventsRetrievedAt : undefined
  )
}

/** Rebuild the `anchorExperience` Json from a stored FactorResult. */
export function anchorExperienceFromFacts(f: FactorResult | undefined): OpportunityAnchorExperience | null {
  if (!f || !f.available) return null
  const title = f.facts.anchorTitle
  if (typeof title !== "string" || !title) return null
  const out: OpportunityAnchorExperience = {
    title,
    kind: (f.facts.anchorKind as AnchorKind) ?? "OTHER",
    source: (f.facts.anchorSource as OpportunityAnchorExperience["source"]) ?? f.source,
  }
  if (typeof f.facts.anchorDate === "string" && f.facts.anchorDate) out.date = f.facts.anchorDate
  if (typeof f.facts.anchorUrl === "string" && f.facts.anchorUrl) out.url = f.facts.anchorUrl
  return out
}
