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
    const key = new Date(item.date).toISOString().split("T")[0]
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateStr, items]) => ({
      date: new Date(dateStr + "T12:00:00"),
      dateStr,
      items: items.sort((a, b) => {
        if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime)
        return a.position - b.position
      }),
    }))
}
