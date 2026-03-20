"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getConfig } from "@/lib/config"
import { revalidatePath } from "next/cache"

export async function getPackingList(tripId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const items = await prisma.packingItem.findMany({
    where: { tripId },
    orderBy: [{ category: "asc" }, { position: "asc" }, { createdAt: "asc" }],
  })

  // Group by category
  const grouped: Record<string, typeof items> = {}
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  }

  const totalItems = items.length
  const packedItems = items.filter((i: { isPacked: boolean }) => i.isPacked).length

  return { items, grouped, totalItems, packedItems }
}

export async function addPackingItem(tripId: string, text: string, category: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const maxPos = await prisma.packingItem.aggregate({
    where: { tripId, category },
    _max: { position: true },
  })

  const item = await prisma.packingItem.create({
    data: {
      tripId,
      text: text.trim(),
      category,
      position: (maxPos._max.position ?? -1) + 1,
    },
  })

  revalidatePath(`/trip/${tripId}/packing`)
  return item
}

export async function togglePackingItem(tripId: string, itemId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const item = await prisma.packingItem.findFirstOrThrow({
    where: { id: itemId, tripId },
  })

  const updated = await prisma.packingItem.update({
    where: { id: itemId },
    data: { isPacked: !item.isPacked },
  })

  revalidatePath(`/trip/${tripId}/packing`)
  return updated
}

export async function deletePackingItem(tripId: string, itemId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  await prisma.packingItem.delete({ where: { id: itemId } })
  revalidatePath(`/trip/${tripId}/packing`)
}

export async function generatePackingList(tripId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  // Check paid plan
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true },
  })
  if (!user || user.plan === "FREE") {
    throw new Error("PLAN_LIMIT: AI packing suggestions require a paid plan.")
  }

  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: tripId, userId: session.user.id },
    include: {
      travelers: { include: { traveler: true } },
      activities: { select: { name: true, category: true } },
      itineraryItems: { select: { title: true, type: true } },
    },
  })

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error("AI service not configured")

  const model = await getConfig("ai.packingModel", "anthropic/claude-haiku-4.5")

  const durationDays = Math.ceil(
    (new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / (1000 * 60 * 60 * 24)
  )

  const travelerInfo = trip.travelers.map((t) => {
    const age = t.traveler.birthDate
      ? Math.floor((Date.now() - new Date(t.traveler.birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      : null
    return `${t.traveler.name}${age !== null ? ` (age ${age})` : ""}${t.traveler.tags.length > 0 ? ` [${t.traveler.tags.join(", ")}]` : ""}`
  })

  const activitiesList = trip.activities.map((a) => `${a.name} (${a.category || "general"})`).join(", ")

  const prompt = `You are a travel packing assistant. Generate a packing list for this trip.

Trip details:
- Destination: ${trip.destination}
- Dates: ${trip.startDate.toISOString().split("T")[0]} to ${trip.endDate.toISOString().split("T")[0]} (${durationDays} days)
- Travelers: ${travelerInfo.length > 0 ? travelerInfo.join(", ") : "1 adult"}
- Planned activities: ${activitiesList || "General sightseeing"}

Consider:
- The likely climate and weather for ${trip.destination} during these dates
- Trip duration (how many changes of clothes etc.)
- Activities planned (hiking gear, formal wear, swimwear, etc.)
- Traveler ages and needs (children, seniors, etc.)

Return ONLY a JSON array of items, each with "text" and "category" fields.
Categories MUST be one of: Clothing, Toiletries, Electronics, Documents, Medical, Entertainment, General

Example:
[
  {"text": "T-shirts (5)", "category": "Clothing"},
  {"text": "Sunscreen SPF 50", "category": "Toiletries"},
  {"text": "Phone charger", "category": "Electronics"},
  {"text": "Passport", "category": "Documents"},
  {"text": "Ibuprofen", "category": "Medical"},
  {"text": "Kindle", "category": "Entertainment"}
]

Generate 20-35 practical items. Be specific about quantities where relevant. Return ONLY valid JSON, no other text.`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`AI request failed: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ""

    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error("Failed to parse AI response")

    const suggestions: { text: string; category: string }[] = JSON.parse(jsonMatch[0])
    const validCategories = ["Clothing", "Toiletries", "Electronics", "Documents", "Medical", "Entertainment", "General"]

    // Get existing items to avoid duplicates
    const existing = await prisma.packingItem.findMany({
      where: { tripId },
      select: { text: true },
    })
    const existingTexts = new Set(existing.map((e: { text: string }) => e.text.toLowerCase()))

    // Filter and create items
    const newItems = suggestions
      .filter((s) => s.text && !existingTexts.has(s.text.toLowerCase()))
      .map((s) => ({
        tripId,
        text: s.text,
        category: validCategories.includes(s.category) ? s.category : "General",
        position: 0,
      }))

    if (newItems.length > 0) {
      await prisma.packingItem.createMany({ data: newItems })
    }

    revalidatePath(`/trip/${tripId}/packing`)
    return { added: newItems.length }
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

export type PackingListResult = Awaited<ReturnType<typeof getPackingList>>
export type PackingItemResult = Awaited<ReturnType<typeof addPackingItem>>
