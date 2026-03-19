import { haversineDistance, estimateTravelTimeMins } from "./haversine"

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

export interface OptimizerConfig {
  startDate: Date
  endDate: Date
  hotelLat?: number | null
  hotelLng?: number | null
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

  reasoning.push(`Sorted ${sorted.length} activities by priority`)

  // Step 3: For each day, find fixed items to determine available windows
  const bufferMins = PACING_BUFFER[config.pacingStyle]
  const maxPerDay = MAX_ACTIVITIES_PER_DAY[config.pacingStyle]
  const activitiesToSchedule = [...sorted]
  let totalCost = 0

  for (const day of days) {
    const dayStr = formatDate(day)
    const dayFixed = fixedItems.filter(f => formatDate(f.date) === dayStr)
    const availableWindows = computeAvailableWindows(
      day,
      config.wakeUpTime,
      config.bedTime,
      dayFixed
    )

    let scheduledToday = 0
    let lastLat = config.hotelLat ?? null
    let lastLng = config.hotelLng ?? null

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
          totalCost
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

  reasoning.push(`Scheduled ${scheduled.length} activities, ${unscheduled.length} unscheduled`)
  reasoning.push(`Estimated total activity cost: $${totalCost.toFixed(2)}`)

  return { scheduledItems: scheduled, unscheduled, totalCost, reasoning }
}

function findBestActivity(
  activities: ActivityInput[],
  lastLat: number | null,
  lastLng: number | null,
  day: Date,
  availableMins: number,
  dailyBudget: number | null | undefined,
  totalCost: number
): ActivityInput | null {
  // Filter by duration
  const fitting = activities.filter(a => a.durationMins <= availableMins)
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
  fixedItems: FixedItem[]
): { startTime: string; availableMins: number }[] {
  // Simple version: return one big window per day minus fixed items
  const wake = timeToMins(wakeUp)
  const bed = timeToMins(bedTime)

  const blocked: { start: number; end: number }[] = fixedItems.map(f => ({
    start: timeToMins(f.startTime),
    end: timeToMins(f.startTime) + f.durationMins,
  }))

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
