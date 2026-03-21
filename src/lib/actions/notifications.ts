"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

// ─── Get notifications for current user ──────────────────────────────────────

export async function getNotifications(limit = 20) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  return prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
}

// ─── Get unread count ────────────────────────────────────────────────────────

export async function getUnreadCount() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  return prisma.notification.count({
    where: { userId: session.user.id, read: false },
  })
}

// ─── Mark a single notification as read ──────────────────────────────────────

export async function markNotificationRead(notificationId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.notification.updateMany({
    where: { id: notificationId, userId: session.user.id },
    data: { read: true },
  })
}

// ─── Mark all notifications as read ──────────────────────────────────────────

export async function markAllNotificationsRead() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.notification.updateMany({
    where: { userId: session.user.id, read: false },
    data: { read: true },
  })
}

// createNotification is in src/lib/notifications-internal.ts (not a server action)

// ─── Delete a notification ───────────────────────────────────────────────────

export async function deleteNotification(notificationId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.notification.deleteMany({
    where: { id: notificationId, userId: session.user.id },
  })
}
