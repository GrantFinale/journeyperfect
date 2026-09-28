/**
 * Prisma-backed `WatchStore` for the price-watch runner. Kept apart from
 * ./watch-runner.ts so the loop stays testable without a database.
 */
import { prisma } from "@/lib/db"
import { createNotification } from "@/lib/notifications-internal"
import { sendEmail } from "@/lib/email"
import { putCached } from "./cache"
import { searchRowToQuery } from "./rows"
import type { WatchAlert, WatchCheckResult, WatchRecord, WatchStore } from "./watch-runner"

export function createPrismaWatchStore(): WatchStore {
  return {
    async listDue({ cutoff, take, afterId }) {
      const rows = await prisma.flightSearch.findMany({
        where: {
          isTracking: true,
          OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: cutoff } }],
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        orderBy: { id: "asc" },
        take,
      })
      return rows.map(
        (row): WatchRecord => ({
          id: row.id,
          userId: row.userId,
          tripId: row.tripId,
          query: searchRowToQuery(row),
          targetPrice: row.targetPrice,
          lastPrice: row.lastPrice,
          lowestPrice: row.lowestPrice,
          lastCheckedAt: row.lastCheckedAt,
        })
      )
    },

    async recordCheck(watch: WatchRecord, result: WatchCheckResult) {
      await putCached(
        watch.id,
        { offers: result.offers, insight: result.insight, retrievedAt: result.retrievedAt.toISOString(), fromCache: false },
        { provider: result.provider, recordPricePoint: true }
      )
    },

    async notify(watch: WatchRecord, alert: WatchAlert) {
      await createNotification({
        userId: watch.userId,
        type: "flight_alert",
        title: alert.message.title,
        message: alert.message.message,
        link: alert.message.link,
      })
      const user = await prisma.user.findUnique({ where: { id: watch.userId }, select: { email: true } })
      if (user?.email) {
        await sendEmail({ to: user.email, subject: alert.message.subject, text: alert.message.message, html: alert.message.html })
      }
    },

    async expire(watch: WatchRecord) {
      await prisma.flightSearch.update({ where: { id: watch.id }, data: { isTracking: false } })
    },
  }
}
