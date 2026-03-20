"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export interface PendingEmailItem {
  id: string
  type: string | null
  subject: string
  from: string
  parsedData: Record<string, unknown> | null
  createdAt: string
}

export async function checkPendingEmails(): Promise<PendingEmailItem[]> {
  const session = await auth()
  if (!session?.user?.id) return []

  const emails = await prisma.pendingEmail.findMany({
    where: {
      userId: session.user.id,
      processed: false,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      subject: true,
      from: true,
      parsedData: true,
      createdAt: true,
    },
  })

  return emails.map((e) => ({
    ...e,
    parsedData: e.parsedData as Record<string, unknown> | null,
    createdAt: e.createdAt.toISOString(),
  }))
}

export async function markEmailsProcessed(emailIds: string[]): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) return

  await prisma.pendingEmail.updateMany({
    where: {
      id: { in: emailIds },
      userId: session.user.id,
    },
    data: { processed: true },
  })
}
