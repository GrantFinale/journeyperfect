export type ItineraryItemForGrouping = {
  id: string
  date: Date
  startTime: string | null
  position: number
}

export type GroupedDay<T extends ItineraryItemForGrouping> = {
  date: Date
  dateStr: string
  items: T[]
}

export function groupByDay<T extends ItineraryItemForGrouping>(items: T[]): GroupedDay<T>[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    // Use UTC date parts directly to avoid timezone conversion issues
    // Itinerary item dates are stored as midnight UTC for the intended local date
    const d = new Date(item.date)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateStr, items]) => ({
      date: new Date(dateStr + "T12:00:00"),
      dateStr,
      items: items.sort((a, b) => {
        // Sort by startTime first (chronological order)
        // Use position as tiebreaker for items at the same time (user drag reorder)
        if (a.startTime && b.startTime) {
          const timeCompare = a.startTime.localeCompare(b.startTime)
          if (timeCompare !== 0) return timeCompare
        }
        // Items without startTime go after items with startTime
        if (a.startTime && !b.startTime) return -1
        if (!a.startTime && b.startTime) return 1
        // Same time or both no time — use position
        return a.position - b.position
      }),
    }))
}
