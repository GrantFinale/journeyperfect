"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { hasFeature, getUpgradeMessage } from "@/lib/features"
import { generateApiKey } from "@/lib/mcp/auth"
import { revalidatePath } from "next/cache"
import { z } from "zod"

/** Active keys per user; revoked ones do not count. */
const MAX_ACTIVE_KEYS = 10

export interface ApiKeySummary {
  id: string
  name: string
  prefix: string
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

async function requireUserId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return session.user.id
}

export async function listApiKeys(): Promise<ApiKeySummary[]> {
  const userId = await requireUserId()
  return prisma.apiKey.findMany({
    where: { userId },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })
}

const nameSchema = z.string().trim().min(1, "Give the key a name").max(60, "Keep the name under 60 characters")

/**
 * Creates a key and returns the plaintext exactly once. Only the sha256 hash
 * is stored, so there is no way to show it again.
 */
export async function createApiKey(name: string): Promise<ApiKeySummary & { plaintext: string }> {
  const userId = await requireUserId()
  const parsedName = nameSchema.parse(name)

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
  if (!user || !hasFeature(user.plan, "mcpAccess")) {
    throw new Error(`UPGRADE_REQUIRED:${getUpgradeMessage("mcpAccess")}`)
  }

  const activeCount = await prisma.apiKey.count({ where: { userId, revokedAt: null } })
  if (activeCount >= MAX_ACTIVE_KEYS) {
    throw new Error(`LIMIT:You already have ${MAX_ACTIVE_KEYS} active keys. Revoke one before creating another.`)
  }

  const { plaintext, prefix, keyHash } = generateApiKey()
  const key = await prisma.apiKey.create({
    data: { userId, name: parsedName, prefix, keyHash },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
  })

  revalidatePath("/settings/api-keys")
  return { ...key, plaintext }
}

export async function revokeApiKey(id: string): Promise<void> {
  const userId = await requireUserId()
  // updateMany so a foreign id is a no-op rather than a leak of its existence.
  await prisma.apiKey.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  revalidatePath("/settings/api-keys")
}
