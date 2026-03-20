"use server"

import { requireTripAccess } from "@/lib/auth-trip"
import { prisma } from "@/lib/db"
import { getConfig } from "@/lib/config"
import { hasFeature } from "@/lib/features"

export type DiningRecommendation = {
  name: string
  cuisine: string
  priceRange: string
  reason: string
  bestFor: "breakfast" | "lunch" | "dinner" | "any"
  kidsFriendly: boolean
  dietaryOptions: string[]
  neighborhood: string
}

export async function getAIDiningRecommendations(
  tripId: string,
  city: string
): Promise<DiningRecommendation[]> {
  const { userId } = await requireTripAccess(tripId)

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })
  if (!user || !hasFeature(user.plan, "aiFlightParsing")) {
    throw new Error("UPGRADE_REQUIRED")
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error("AI not configured")

  const model = await getConfig("ai.diningModel", "anthropic/claude-haiku-4.5")

  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: tripId },
    include: { travelers: { include: { traveler: true } } },
  })

  const hasKids = trip.travelers.some((t) =>
    t.traveler.tags.includes("child")
  )

  const prompt = `You are a local food expert for ${city}. Recommend 8 restaurants for a group traveling there.

Context:
- Travelers: ${trip.travelers.map((t) => `${t.traveler.name} (${t.traveler.tags.join(", ") || "adult"})`).join(", ") || "2 adults"}
- Trip dates: ${trip.startDate.toISOString().split("T")[0]} to ${trip.endDate.toISOString().split("T")[0]}
${hasKids ? "- IMPORTANT: Include family-friendly options with kids menus" : ""}

For each restaurant, provide:
- name: Restaurant name (must be a real, currently open restaurant)
- cuisine: Type of food
- priceRange: "$" to "$$$$"
- reason: Why this restaurant fits this group (1 sentence)
- bestFor: "breakfast" | "lunch" | "dinner" | "any"
- kidsFriendly: true/false
- dietaryOptions: ["vegetarian", "vegan", "gluten-free"] (any that apply)
- neighborhood: Area of the city

Return ONLY a JSON array. No other text.`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
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
      }
    )

    clearTimeout(timeout)
    if (!response.ok) return []

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ""

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content.trim()
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim()
    }

    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return []

    // Validate and sanitize each recommendation
    return parsed
      .filter(
        (r: Record<string, unknown>) =>
          typeof r.name === "string" && typeof r.cuisine === "string"
      )
      .map(
        (r: Record<string, unknown>): DiningRecommendation => ({
          name: String(r.name),
          cuisine: String(r.cuisine || ""),
          priceRange: String(r.priceRange || "$$"),
          reason: String(r.reason || ""),
          bestFor: (["breakfast", "lunch", "dinner", "any"].includes(
            String(r.bestFor)
          )
            ? String(r.bestFor)
            : "any") as DiningRecommendation["bestFor"],
          kidsFriendly: Boolean(r.kidsFriendly),
          dietaryOptions: Array.isArray(r.dietaryOptions)
            ? r.dietaryOptions.map(String)
            : [],
          neighborhood: String(r.neighborhood || ""),
        })
      )
  } catch {
    clearTimeout(timeout)
    return []
  }
}
