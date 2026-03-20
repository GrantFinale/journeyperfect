"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { getConfig } from "@/lib/config"
import { revalidatePath } from "next/cache"

export async function getPackingList(tripId: string) {
  await requireTripAccess(tripId)

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
  await requireTripAccess(tripId, "EDITOR")

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
  await requireTripAccess(tripId, "EDITOR")

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
  await requireTripAccess(tripId, "EDITOR")

  await prisma.packingItem.delete({ where: { id: itemId } })
  revalidatePath(`/trip/${tripId}/packing`)
}

// Basic packing list generator — free for all users, no AI
// Takes trip duration and trip type tags to generate appropriate items
export async function generateBasicPackingList(
  tripId: string,
  tripTypes: string[]
) {
  await requireTripAccess(tripId, "EDITOR")

  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: tripId },
  })

  const days = Math.max(1, Math.ceil(
    (new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / 86400000
  ))

  // Scale clothing by trip duration
  const tops = Math.min(days, 7)
  const bottoms = Math.min(Math.ceil(days / 2), 5)
  const underwear = Math.min(days + 1, 8)
  const socks = Math.min(days + 1, 8)

  const items: { text: string; category: string }[] = [
    // Clothing — always
    { text: `T-shirts/tops (${tops})`, category: "Clothing" },
    { text: `Bottoms/pants (${bottoms})`, category: "Clothing" },
    { text: `Underwear (${underwear})`, category: "Clothing" },
    { text: `Socks (${socks} pairs)`, category: "Clothing" },
    { text: "Pajamas", category: "Clothing" },
    { text: "Comfortable walking shoes", category: "Clothing" },
    { text: "Light jacket or hoodie", category: "Clothing" },
    // Toiletries — always
    { text: "Toothbrush & toothpaste", category: "Toiletries" },
    { text: "Deodorant", category: "Toiletries" },
    { text: "Shampoo & conditioner", category: "Toiletries" },
    { text: "Sunscreen", category: "Toiletries" },
    { text: "Lip balm", category: "Toiletries" },
    // Electronics — always
    { text: "Phone charger", category: "Electronics" },
    { text: "Portable battery pack", category: "Electronics" },
    { text: "Headphones/earbuds", category: "Electronics" },
    // Documents — always
    { text: "ID / Driver's license", category: "Documents" },
    { text: "Boarding passes / confirmations", category: "Documents" },
    { text: "Insurance cards", category: "Documents" },
    // Medical — always
    { text: "Prescription medications", category: "Medical" },
    { text: "Pain reliever (ibuprofen/Tylenol)", category: "Medical" },
    { text: "Band-aids", category: "Medical" },
    // General — always
    { text: "Luggage locks", category: "General" },
    { text: "Reusable water bottle", category: "General" },
    { text: "Snacks for travel", category: "General" },
  ]

  // Trip type specific items
  const typeItems: Record<string, { text: string; category: string }[]> = {
    beach: [
      { text: "Swimsuit(s)", category: "Clothing" },
      { text: "Flip flops / sandals", category: "Clothing" },
      { text: "Cover-up / sarong", category: "Clothing" },
      { text: "Beach towel", category: "General" },
      { text: "Sunglasses", category: "General" },
      { text: "Aloe vera / after-sun lotion", category: "Toiletries" },
      { text: "Waterproof phone pouch", category: "Electronics" },
      { text: "Hat / sun hat", category: "Clothing" },
    ],
    ski: [
      { text: "Ski jacket / snow coat", category: "Clothing" },
      { text: "Snow pants", category: "Clothing" },
      { text: "Thermal base layers (top + bottom)", category: "Clothing" },
      { text: "Wool socks (3+ pairs)", category: "Clothing" },
      { text: "Ski gloves / mittens", category: "Clothing" },
      { text: "Warm beanie / hat", category: "Clothing" },
      { text: "Neck gaiter / balaclava", category: "Clothing" },
      { text: "Goggles", category: "General" },
      { text: "Hand & toe warmers", category: "General" },
      { text: "Moisturizer (cold weather)", category: "Toiletries" },
      { text: "SPF lip balm", category: "Toiletries" },
    ],
    golf: [
      { text: "Golf polo shirts (${Math.min(days, 4)})", category: "Clothing" },
      { text: "Golf shorts / pants", category: "Clothing" },
      { text: "Golf shoes", category: "Clothing" },
      { text: "Golf glove", category: "General" },
      { text: "Golf balls", category: "General" },
      { text: "Divot repair tool & ball markers", category: "General" },
      { text: "Golf hat / visor", category: "Clothing" },
      { text: "Rain gear (golf)", category: "Clothing" },
    ],
    hiking: [
      { text: "Hiking boots / trail shoes", category: "Clothing" },
      { text: "Moisture-wicking shirts", category: "Clothing" },
      { text: "Hiking pants / convertible pants", category: "Clothing" },
      { text: "Rain jacket (packable)", category: "Clothing" },
      { text: "Hiking socks (wool blend)", category: "Clothing" },
      { text: "Backpack / daypack", category: "General" },
      { text: "Trail snacks / energy bars", category: "General" },
      { text: "Blister pads / moleskin", category: "Medical" },
      { text: "Bug spray / insect repellent", category: "Toiletries" },
    ],
    business: [
      { text: "Dress shirts (${Math.min(days, 4)})", category: "Clothing" },
      { text: "Dress pants / slacks", category: "Clothing" },
      { text: "Blazer / sport coat", category: "Clothing" },
      { text: "Dress shoes", category: "Clothing" },
      { text: "Belt", category: "Clothing" },
      { text: "Tie(s)", category: "Clothing" },
      { text: "Laptop & charger", category: "Electronics" },
      { text: "Business cards", category: "Documents" },
      { text: "Garment bag", category: "General" },
    ],
    camping: [
      { text: "Tent", category: "General" },
      { text: "Sleeping bag", category: "General" },
      { text: "Sleeping pad / air mattress", category: "General" },
      { text: "Flashlight / headlamp + batteries", category: "Electronics" },
      { text: "Camp stove + fuel", category: "General" },
      { text: "Cooler", category: "General" },
      { text: "Bug spray / insect repellent", category: "Toiletries" },
      { text: "Multi-tool / pocket knife", category: "General" },
      { text: "Fire starter / matches", category: "General" },
      { text: "Camp chairs", category: "General" },
    ],
    international: [
      { text: "Passport", category: "Documents" },
      { text: "Visa (if required)", category: "Documents" },
      { text: "Travel adapter / converter", category: "Electronics" },
      { text: "Copy of passport (digital + paper)", category: "Documents" },
      { text: "Foreign currency / travel card", category: "Documents" },
      { text: "Translation app (downloaded offline)", category: "Electronics" },
    ],
    family: [
      { text: "Kids' snacks & drinks", category: "General" },
      { text: "Kids' entertainment (tablet, books, toys)", category: "Entertainment" },
      { text: "Stroller (if needed)", category: "General" },
      { text: "Children's medications", category: "Medical" },
      { text: "Baby wipes", category: "Toiletries" },
      { text: "Extra change of clothes (kids)", category: "Clothing" },
    ],
  }

  for (const type of tripTypes) {
    const extra = typeItems[type]
    if (extra) items.push(...extra)
  }

  // Deduplicate by text
  const seen = new Set<string>()
  const deduped = items.filter(item => {
    const key = item.text.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Check existing items to avoid duplicates with what's already in the list
  const existing = await prisma.packingItem.findMany({
    where: { tripId },
    select: { text: true },
  })
  const existingTexts = new Set(existing.map((e: { text: string }) => e.text.toLowerCase()))

  const newItems = deduped
    .filter(item => !existingTexts.has(item.text.toLowerCase()))
    .map((item, i) => ({
      tripId,
      text: item.text,
      category: item.category,
      position: i,
    }))

  if (newItems.length > 0) {
    await prisma.packingItem.createMany({ data: newItems })
  }

  revalidatePath(`/trip/${tripId}/packing`)
  return { added: newItems.length }
}

// AI-powered packing list generator — paid plans only
export async function generatePackingList(tripId: string) {
  const { userId } = await requireTripAccess(tripId, "EDITOR")

  // Check paid plan
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })
  if (!user || user.plan === "FREE") {
    throw new Error("PLAN_LIMIT: AI packing suggestions require a paid plan.")
  }

  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: tripId },
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
