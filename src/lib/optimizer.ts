import { haversineDistance, estimateTravelTimeMins } from "./haversine"
import {
  MEAL_SLOTS,
  MEAL_WINDOWS,
  isDiningCategory,
  resolveMealSlots,
  type MealSlot,
} from "./meal-slots"

export interface ActivityInput {
  id: string
  name: string
  lat?: number | null
  lng?: number | null
  durationMins: number
  priority: "MUST_DO" | "HIGH" | "MEDIUM" | "LOW"
  isFixed: boolean
  fixedDateTime?: Date | null
  hoursJson?: string | null
  costPerAdult: number
  costPerChild: number
  status: string
  category?: string | null
  /** JSON array of MealSlot, set by the user in Discover. */
  mealSlots?: string | null
  address?: string | null
  /** Optional pre-parsed city; falls back to parsing `address`. */
  city?: string | null
  rating?: number | null
}

export interface FixedItem {
  id: string
  type: "FLIGHT" | "HOTEL_CHECK_IN" | "HOTEL_CHECK_OUT"
  date: Date
  startTime: string
  durationMins: number
  title: string
  lat?: number | null
  lng?: number | null
}

/**
 * Where the travellers are based on a given day — the hotel they're sleeping at,
 * or the trip origin/destination when there's no lodging on file. Everything
 * scheduled that day has to be within {@link MAX_DAY_RADIUS_KM} of this point.
 */
export interface DayBase {
  lat: number | null
  lng: number | null
  city: string | null
  name: string
}

/**
 * Hard geo-fence radius. Anything farther than this from the day's lodging base
 * is not a same-day trip — this is what keeps Wisconsin Dells off a Chicago day.
 */
export const MAX_DAY_RADIUS_KM = 60

export interface OptimizerConfig {
  startDate: Date
  endDate: Date
  /** yyyy-MM-dd -> that day's lodging base. */
  dayBases?: Record<string, DayBase>
  /** Used for any day missing from `dayBases` (callers with no lodging at all). */
  fallbackBase?: DayBase | null
  dailyBudget?: number | null
  pacingStyle: "CHILL" | "LEISURELY" | "MODERATE" | "ACTIVE" | "PACKED"
  wakeUpTime: string // "HH:MM"
  bedTime: string
  adultCount: number
  childCount: number
}

export interface ScheduledItem {
  activityId: string
  date: Date
  startTime: string
  endTime: string
  durationMins: number
  travelTimeToNextMins: number
  costEstimate: number
  /** MEAL for dining venues placed in a meal window, ACTIVITY for everything else. */
  type: "ACTIVITY" | "MEAL"
  mealSlot?: MealSlot
  reasoning?: string
}

export interface OptimizationResult {
  scheduledItems: ScheduledItem[]
  unscheduled: { activityId: string; reason: string }[]
  totalCost: number
  reasoning: string[]
}

const PACING_BUFFER: Record<string, number> = {
  CHILL: 45, LEISURELY: 30, MODERATE: 20, ACTIVE: 10, PACKED: 5,
}

const MAX_ACTIVITIES_PER_DAY: Record<string, number> = {
  CHILL: 2, LEISURELY: 3, MODERATE: 4, ACTIVE: 5, PACKED: 6,
}

/** Granularity used when hunting for a free start time inside a meal window. */
const MEAL_PLACEMENT_STEP_MINS = 15

// ─── Geo-fencing helpers ─────────────────────────────────────────────────────

/**
 * Pulls the city out of a formatted address, e.g.
 * "600 N State St, Chicago, IL 60654, USA" -> "Chicago".
 * Tuned for the US-style "…, City, ST 12345, Country" shape Google returns.
 * Returns null when the address is missing or doesn't have a city segment.
 */
export function parseCityFromAddress(address?: string | null): string | null {
  if (!address) return null
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return null

  let end = parts.length - 1
  // Drop a trailing country.
  if (/^(usa|u\.?s\.?a?\.?|united states( of america)?|canada|mexico)$/i.test(parts[end])) end--
  if (end < 0) return null

  // The last remaining segment is usually "ST" or "ST 12345".
  const isStateZip = /^[A-Za-z]{2}\.?(\s+\d{5}(-\d{4})?)?$/.test(parts[end])
  const cityIdx = isStateZip ? end - 1 : end
  if (cityIdx < 0) return null

  const city = parts[cityIdx].replace(/\s+\d{5}(-\d{4})?$/, "").trim()
  return city || null
}

function normalizeCity(city?: string | null): string | null {
  if (!city) return null
  const n = city.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  return n || null
}

function activityCity(a: ActivityInput): string | null {
  return normalizeCity(a.city) ?? normalizeCity(parseCityFromAddress(a.address))
}

/**
 * True when `a` may be scheduled on a day based at `base`.
 *
 * With coordinates on both sides this is a straight radius check. Without
 * coordinates we fall back to a city-name match; when neither side gives us
 * anything to compare we allow it rather than silently dropping the activity.
 */
export function isWithinDayBase(a: ActivityInput, base: DayBase | null | undefined): boolean {
  if (!base) return true

  if (a.lat != null && a.lng != null && base.lat != null && base.lng != null) {
    return haversineDistance(base.lat, base.lng, a.lat, a.lng) <= MAX_DAY_RADIUS_KM
  }

  // No coordinates on the activity — fall back to matching city names.
  const baseCity = normalizeCity(base.city)
  const aCity = activityCity(a)
  if (!baseCity || !aCity) return true
  return aCity === baseCity || aCity.includes(baseCity) || baseCity.includes(aCity)
}

function baseForDay(config: OptimizerConfig, dayStr: string): DayBase | null {
  return config.dayBases?.[dayStr] ?? config.fallbackBase ?? null
}

// ─── Dining helpers ──────────────────────────────────────────────────────────

export function isDiningActivity(a: ActivityInput): boolean {
  return isDiningCategory(a.category) || !!(a.mealSlots && a.mealSlots.trim() && a.mealSlots !== "[]")
}

interface Block { start: number; end: number }

function overlapsAny(start: number, end: number, blocks: Block[]): boolean {
  return blocks.some((b) => start < b.end && end > b.start)
}

/**
 * Finds the free start time inside a meal window closest to the window's target,
 * or null when the window is fully occupied.
 */
function findFreeMealStart(slot: MealSlot, durationMins: number, occupied: Block[]): number | null {
  const win = MEAL_WINDOWS[slot]
  const latest = win.endMin - durationMins
  if (latest < win.startMin) return null

  let best: number | null = null
  for (let s = win.startMin; s <= latest; s += MEAL_PLACEMENT_STEP_MINS) {
    if (overlapsAny(s, s + durationMins, occupied)) continue
    if (best === null || Math.abs(s - win.targetMin) < Math.abs(best - win.targetMin)) best = s
  }
  return best
}

// ─── Optimizer ───────────────────────────────────────────────────────────────

export function optimizeItinerary(
  activities: ActivityInput[],
  fixedItems: FixedItem[],
  config: OptimizerConfig
): OptimizationResult {
  const reasoning: string[] = []
  const scheduled: ScheduledItem[] = []
  const unscheduled: { activityId: string; reason: string }[] = []

  // Step 1: Build list of trip days
  const days = getDaysBetween(config.startDate, config.endDate)
  reasoning.push(`Planning ${days.length} days from ${formatDate(config.startDate)} to ${formatDate(config.endDate)}`)

  // Step 2: Sort activities by priority
  const priorityOrder = { MUST_DO: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
  const sorted = [...activities]
    .filter(a => a.status === "WISHLIST" || a.status === "SCHEDULED")
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  // Step 2b: Split dining venues out — they're time-anchored to meal windows and
  // must never be packed back to back like ordinary activities.
  const activitiesToSchedule: ActivityInput[] = []
  const diningPool: { activity: ActivityInput; slots: MealSlot[] }[] = []

  for (const a of sorted) {
    if (!isDiningActivity(a)) {
      activitiesToSchedule.push(a)
      continue
    }
    const slots = resolveMealSlots(a.mealSlots, a.hoursJson)
    if (!slots || slots.length === 0) {
      // We don't know when to eat here — leave it in the wishlist for the user.
      unscheduled.push({
        activityId: a.id,
        reason: "No meal times known for this restaurant — set breakfast/lunch/dinner/drinks to auto-plan it",
      })
      continue
    }
    diningPool.push({ activity: a, slots })
  }

  reasoning.push(
    `Sorted ${activitiesToSchedule.length} activities and ${diningPool.length} dining venues by priority`
  )

  // Step 3: For each day, place meals first, then pack activities around them
  const bufferMins = PACING_BUFFER[config.pacingStyle]
  const maxPerDay = MAX_ACTIVITIES_PER_DAY[config.pacingStyle]
  let totalCost = 0

  for (const day of days) {
    const dayStr = formatDate(day)
    const dayFixed = fixedItems.filter(f => formatDate(f.date) === dayStr)
    const base = baseForDay(config, dayStr)

    const wakeMin = timeToMins(config.wakeUpTime)
    const bedMin = timeToMins(config.bedTime)
    const occupied: Block[] = dayFixed.map(f => ({
      start: timeToMins(f.startTime),
      end: timeToMins(f.startTime) + f.durationMins,
    }))

    // 3a. Meals — at most one venue per slot per day, inside its window.
    for (const slot of MEAL_SLOTS) {
      if (diningPool.length === 0) break

      const eligible = diningPool.filter(
        (d) => d.slots.includes(slot) && isWithinDayBase(d.activity, base)
      )
      if (eligible.length === 0) continue

      const pick = pickBestDining(eligible, base)
      const win = MEAL_WINDOWS[slot]
      const desired = pick.activity.durationMins > 0 ? pick.activity.durationMins : win.durationMins
      const durationMins = Math.min(desired, win.endMin - win.startMin)

      // Don't schedule a meal outside the traveller's waking hours.
      const startMin = findFreeMealStart(slot, durationMins, [
        ...occupied,
        { start: 0, end: wakeMin },
        { start: bedMin, end: 24 * 60 },
      ])
      if (startMin === null) continue

      let travelTime = 0
      if (base?.lat != null && base?.lng != null && pick.activity.lat != null && pick.activity.lng != null) {
        travelTime = estimateTravelTimeMins(
          haversineDistance(base.lat, base.lng, pick.activity.lat, pick.activity.lng)
        )
      }

      const cost =
        pick.activity.costPerAdult * config.adultCount + pick.activity.costPerChild * config.childCount

      scheduled.push({
        activityId: pick.activity.id,
        date: day,
        startTime: minsToTime(startMin),
        endTime: minsToTime(startMin + durationMins),
        durationMins,
        travelTimeToNextMins: travelTime,
        costEstimate: cost,
        type: "MEAL",
        mealSlot: slot,
        reasoning: `${win.label} on ${dayStr}${base ? ` near ${base.name}` : ""}`,
      })

      totalCost += cost
      occupied.push({ start: startMin, end: startMin + durationMins })
      diningPool.splice(diningPool.indexOf(pick), 1)
    }

    // 3b. Activities fill the gaps left by fixed items and meals.
    const availableWindows = computeAvailableWindows(
      day,
      config.wakeUpTime,
      config.bedTime,
      dayFixed,
      occupied
    )

    let scheduledToday = 0
    // Each day starts from that day's lodging base, not the first hotel of the trip.
    let lastLat = base?.lat ?? null
    let lastLng = base?.lng ?? null

    for (const window of availableWindows) {
      if (activitiesToSchedule.length === 0) break
      if (scheduledToday >= maxPerDay) break

      let windowMinutes = window.availableMins
      let currentTime = window.startTime

      while (windowMinutes > 60 && activitiesToSchedule.length > 0 && scheduledToday < maxPerDay) {
        // Find best activity for this window considering location
        const candidate = findBestActivity(
          activitiesToSchedule,
          lastLat,
          lastLng,
          day,
          windowMinutes,
          config.dailyBudget,
          totalCost,
          base
        )

        if (!candidate) break

        // Calculate travel time from last position
        let travelTime = 0
        if (lastLat && lastLng && candidate.lat && candidate.lng) {
          const dist = haversineDistance(lastLat, lastLng, candidate.lat, candidate.lng)
          travelTime = estimateTravelTimeMins(dist)
        }

        const totalNeeded = travelTime + candidate.durationMins + bufferMins
        if (totalNeeded > windowMinutes) {
          activitiesToSchedule.splice(activitiesToSchedule.indexOf(candidate), 1)
          unscheduled.push({ activityId: candidate.id, reason: `Doesn't fit in ${windowMinutes}min window on ${dayStr}` })
          break
        }

        const startTime = addMinutes(currentTime, travelTime)
        const endTime = addMinutes(startTime, candidate.durationMins)
        const cost = candidate.costPerAdult * config.adultCount + candidate.costPerChild * config.childCount

        scheduled.push({
          activityId: candidate.id,
          date: day,
          startTime,
          endTime,
          durationMins: candidate.durationMins,
          travelTimeToNextMins: travelTime,
          costEstimate: cost,
          type: "ACTIVITY",
          reasoning: `Scheduled on ${dayStr} (priority: ${candidate.priority})`,
        })

        totalCost += cost
        scheduledToday++
        windowMinutes -= totalNeeded
        currentTime = addMinutes(endTime, bufferMins)
        lastLat = candidate.lat ?? lastLat
        lastLng = candidate.lng ?? lastLng
        activitiesToSchedule.splice(activitiesToSchedule.indexOf(candidate), 1)
      }
    }
  }

  // Remaining activities couldn't be scheduled
  for (const a of activitiesToSchedule) {
    unscheduled.push({ activityId: a.id, reason: "No available time slot found in trip" })
  }
  for (const d of diningPool) {
    unscheduled.push({ activityId: d.activity.id, reason: "No free meal window near the day's base city" })
  }

  // Meals are placed before activities, so sort back into wall-clock order —
  // the writer uses array index as the item's position.
  scheduled.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() || timeToMins(a.startTime) - timeToMins(b.startTime)
  )

  const mealCount = scheduled.filter((s) => s.type === "MEAL").length
  reasoning.push(
    `Scheduled ${scheduled.length - mealCount} activities and ${mealCount} meals, ${unscheduled.length} unscheduled`
  )
  reasoning.push(`Estimated total activity cost: $${totalCost.toFixed(2)}`)

  return { scheduledItems: scheduled, unscheduled, totalCost, reasoning }
}

function pickBestDining(
  candidates: { activity: ActivityInput; slots: MealSlot[] }[],
  base: DayBase | null
): { activity: ActivityInput; slots: MealSlot[] } {
  const priorityScore = { MUST_DO: 100, HIGH: 70, MEDIUM: 40, LOW: 10 }
  let best = candidates[0]
  let bestScore = -Infinity

  for (const c of candidates) {
    let score = priorityScore[c.activity.priority]
    if (base?.lat != null && base?.lng != null && c.activity.lat != null && c.activity.lng != null) {
      score -= haversineDistance(base.lat, base.lng, c.activity.lat, c.activity.lng) * 2
    }
    if (c.activity.rating != null) score += c.activity.rating * 3
    // Prefer venues that only serve this one meal — keep the flexible ones free.
    score += (4 - c.slots.length) * 2

    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }

  return best
}

function findBestActivity(
  activities: ActivityInput[],
  lastLat: number | null,
  lastLng: number | null,
  day: Date,
  availableMins: number,
  dailyBudget: number | null | undefined,
  totalCost: number,
  base?: DayBase | null
): ActivityInput | null {
  // Filter by duration, then hard geo-fence to the day's base city.
  const fitting = activities.filter(a => a.durationMins <= availableMins && isWithinDayBase(a, base))
  if (fitting.length === 0) return null

  // Score each candidate
  let best: ActivityInput | null = null
  let bestScore = -Infinity

  for (const a of fitting) {
    let score = 0

    // Priority score
    const priorityScore = { MUST_DO: 100, HIGH: 70, MEDIUM: 40, LOW: 10 }
    score += priorityScore[a.priority]

    // Proximity bonus (closer = better)
    if (lastLat && lastLng && a.lat && a.lng) {
      const dist = haversineDistance(lastLat, lastLng, a.lat, a.lng)
      score -= dist * 2 // penalize distance
    }

    // Budget check
    if (dailyBudget && totalCost + a.costPerAdult > dailyBudget * 1.2) {
      if (a.priority !== "MUST_DO") score -= 50
    }

    if (score > bestScore) {
      bestScore = score
      best = a
    }
  }

  return best
}

function getDaysBetween(start: Date, end: Date): Date[] {
  const days: Date[] = []
  const cur = new Date(start)
  cur.setUTCHours(0, 0, 0, 0)
  const endDate = new Date(end)
  endDate.setUTCHours(0, 0, 0, 0)
  while (cur <= endDate) {
    days.push(new Date(cur))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return days
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]
}

function computeAvailableWindows(
  day: Date,
  wakeUp: string,
  bedTime: string,
  fixedItems: FixedItem[],
  extraBlocks: Block[] = []
): { startTime: string; availableMins: number }[] {
  // Simple version: return one big window per day minus fixed items and meals
  const wake = timeToMins(wakeUp)
  const bed = timeToMins(bedTime)

  const blocked: { start: number; end: number }[] = [
    ...fixedItems.map(f => ({
      start: timeToMins(f.startTime),
      end: timeToMins(f.startTime) + f.durationMins,
    })),
    ...extraBlocks,
  ]

  const windows: { startTime: string; availableMins: number }[] = []
  let cursor = wake

  for (const block of blocked.sort((a, b) => a.start - b.start)) {
    if (cursor < block.start) {
      windows.push({ startTime: minsToTime(cursor), availableMins: block.start - cursor })
    }
    cursor = Math.max(cursor, block.end)
  }

  if (cursor < bed) {
    windows.push({ startTime: minsToTime(cursor), availableMins: bed - cursor })
  }

  return windows.filter(w => w.availableMins >= 60)
}

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60).toString().padStart(2, "0")
  const m = (mins % 60).toString().padStart(2, "0")
  return `${h}:${m}`
}

function addMinutes(time: string, mins: number): string {
  return minsToTime(timeToMins(time) + mins)
}
