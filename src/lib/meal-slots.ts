/**
 * Meal-slot logic shared by the auto-planner and the save-a-place UIs.
 *
 * A dining venue is only useful to the optimizer if we know *when* it should be
 * eaten at. We derive that from the venue's posted hours when we can, and fall
 * back to asking the user at save time (Activity.mealSlots).
 */

export type MealSlot = "breakfast" | "lunch" | "dinner" | "drinks"

export const MEAL_SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "drinks"]

/** Minutes from midnight. These are the windows the optimizer schedules into. */
export const MEAL_WINDOWS: Record<
  MealSlot,
  { label: string; startMin: number; endMin: number; targetMin: number; durationMins: number }
> = {
  // 7:00–10:30, aim for 8:30
  breakfast: { label: "Breakfast", startMin: 7 * 60, endMin: 10 * 60 + 30, targetMin: 8 * 60 + 30, durationMins: 60 },
  // 11:30–14:30, aim for 12:30
  lunch: { label: "Lunch", startMin: 11 * 60 + 30, endMin: 14 * 60 + 30, targetMin: 12 * 60 + 30, durationMins: 75 },
  // 17:00–21:00, aim for 18:30
  dinner: { label: "Dinner", startMin: 17 * 60, endMin: 21 * 60, targetMin: 18 * 60 + 30, durationMins: 90 },
  // 20:00–23:59, aim for 21:00
  drinks: { label: "Drinks", startMin: 20 * 60, endMin: 23 * 60 + 59, targetMin: 21 * 60, durationMins: 75 },
}

/** Categories that count as "a meal happens here", i.e. must occupy a meal window. */
const DINING_CATEGORIES = new Set([
  "restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "bar",
  "pub",
  "brewery",
  "winery",
  "night_club",
  "meal_takeaway",
  "meal_delivery",
  "food",
  "diner",
  "steak_house",
  "pizza_restaurant",
  "fine_dining_restaurant",
  "breakfast_restaurant",
  "brunch_restaurant",
  "dinner_theater",
])

export function isDiningCategory(category: string | null | undefined): boolean {
  if (!category) return false
  const c = category.toLowerCase()
  if (DINING_CATEGORIES.has(c)) return true
  // Google primaryType values are snake_case and frequently suffixed, e.g.
  // "mexican_restaurant", "sushi_restaurant", "wine_bar", "dinner_theater".
  return /(^|_)(restaurant|cafe|bar|bakery|brewery|winery|pub|diner|bistro|eatery)(_|$)/.test(c)
}

export function parseMealSlots(json: string | null | undefined): MealSlot[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is MealSlot => MEAL_SLOTS.includes(s as MealSlot))
  } catch {
    return []
  }
}

export function serializeMealSlots(slots: MealSlot[]): string | null {
  const unique = MEAL_SLOTS.filter((s) => slots.includes(s))
  return unique.length ? JSON.stringify(unique) : null
}

/** One open interval on one day, in minutes from midnight. */
interface OpenInterval {
  startMin: number
  endMin: number
}

/**
 * Parses one Google Places `weekdayDescriptions` line into open intervals.
 *
 * Real-world shapes:
 *   "Monday: 9:00 AM – 5:00 PM"
 *   "Tuesday: 11:00 AM – 2:00 PM, 5:00 – 10:00 PM"   (meridiem omitted on the first half)
 *   "Wednesday: Closed"
 *   "Thursday: Open 24 hours"
 *   "Friday: 5:00 PM – 12:00 AM"                      (closes after midnight)
 */
function parseHoursLine(line: string): OpenInterval[] {
  const body = line.includes(":") ? line.slice(line.indexOf(":") + 1).trim() : line.trim()
  if (/closed/i.test(body)) return []
  if (/24\s*hours/i.test(body)) return [{ startMin: 0, endMin: 24 * 60 }]

  const intervals: OpenInterval[] = []
  // Split on commas that separate ranges, tolerating the various dash characters.
  for (const chunk of body.split(",")) {
    const match = chunk.match(
      /(\d{1,2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?/
    )
    if (!match) continue

    const [, sh, sm, sMer, eh, em, eMer] = match
    // Google omits the meridiem on the opening time when it matches the closing
    // one ("5:00 – 10:00 PM"), so inherit it.
    const start = toMinutes(sh, sm, sMer ?? eMer)
    let end = toMinutes(eh, em, eMer ?? sMer)
    if (start === null || end === null) continue

    // Closes after midnight ("5:00 PM – 12:00 AM" / "8:00 PM – 2:00 AM").
    if (end <= start) end = 24 * 60
    intervals.push({ startMin: start, endMin: end })
  }
  return intervals
}

function toMinutes(hour: string, minute: string | undefined, meridiem: string | undefined): number | null {
  let h = parseInt(hour, 10)
  const m = minute ? parseInt(minute, 10) : 0
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  if (meridiem) {
    const isPm = /p/i.test(meridiem)
    if (isPm && h !== 12) h += 12
    if (!isPm && h === 12) h = 0
  }
  return h * 60 + m
}

/** Minimum overlap with a meal window before we'll claim the venue serves it. */
const MIN_WINDOW_OVERLAP_MINS = 45

/**
 * Derives which meals a venue can serve from its posted hours.
 *
 * Returns `null` when the hours are missing or unparseable — the caller should
 * then ask the user. Returns `[]` when hours parsed cleanly but overlap no meal
 * window (e.g. a 2pm–4pm dessert bar), which is a real answer, not a failure.
 */
export function deriveMealSlotsFromHours(hoursJson: string | null | undefined): MealSlot[] | null {
  if (!hoursJson) return null

  let lines: string[]
  try {
    const parsed = JSON.parse(hoursJson)
    if (!Array.isArray(parsed)) return null
    lines = parsed.filter((l): l is string => typeof l === "string")
  } catch {
    return null
  }
  if (!lines.length) return null

  const perDay = lines.map(parseHoursLine)
  // Every day unparseable (or every day closed) tells us nothing useful.
  if (perDay.every((intervals) => intervals.length === 0)) return null

  const slots = MEAL_SLOTS.filter((slot) => {
    const win = MEAL_WINDOWS[slot]
    // Serves this meal if it's open across the window on any day of the week.
    return perDay.some((intervals) =>
      intervals.some(
        (iv) => Math.min(iv.endMin, win.endMin) - Math.max(iv.startMin, win.startMin) >= MIN_WINDOW_OVERLAP_MINS
      )
    )
  })

  // A venue open all day long reads as "serves everything", which is useless for
  // routing — treat it as unknown so the user is asked instead.
  return slots.length === MEAL_SLOTS.length ? null : slots
}

/**
 * The slots to plan a venue into: what the user told us, else what its hours
 * imply, else `null` meaning "unknown — don't auto-schedule as a meal".
 */
export function resolveMealSlots(
  mealSlots: string | null | undefined,
  hoursJson: string | null | undefined
): MealSlot[] | null {
  const explicit = parseMealSlots(mealSlots)
  if (explicit.length) return explicit
  const derived = deriveMealSlotsFromHours(hoursJson)
  return derived && derived.length ? derived : null
}
