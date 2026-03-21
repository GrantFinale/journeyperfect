// Internal notification helper — NOT a "use server" file, so it cannot be
// called directly from the client.  Import this where you need to create
// notifications from server-side code (e.g. webhook handlers, cron jobs).

import { prisma } from "@/lib/db"

export async function createNotification(data: {
  userId: string
  type: string
  title: string
  message: string
  link?: string
}) {
  return prisma.notification.create({ data })
}
