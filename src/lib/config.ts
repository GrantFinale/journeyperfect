import { prisma } from "./db"

const cache = new Map<string, { value: string; expiry: number }>()
const TTL = 60_000 // 60 seconds

export async function getConfig(key: string, defaultValue: string): Promise<string> {
  const cached = cache.get(key)
  if (cached && Date.now() < cached.expiry) {
    return cached.value
  }

  try {
    const row = await prisma.appConfig.findUnique({ where: { key } })
    const value = row?.value ?? defaultValue
    cache.set(key, { value, expiry: Date.now() + TTL })
    return value
  } catch {
    return defaultValue
  }
}

export async function setConfig(key: string, value: string): Promise<void> {
  await prisma.appConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
  cache.set(key, { value, expiry: Date.now() + TTL })
}

export async function getAllConfigs(): Promise<Record<string, string>> {
  const rows = await prisma.appConfig.findMany()
  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = row.value
    cache.set(row.key, { value: row.value, expiry: Date.now() + TTL })
  }
  return result
}
