"use server"

import { requireTripAccess } from "@/lib/auth-trip"
import { prisma } from "@/lib/db"
import { getConfig } from "@/lib/config"
import { hasFeature } from "@/lib/features"
import { logAIUsage } from "@/lib/ai-usage"

export type AIPick = {
  name: string
  description: string
  category: string
  estimatedDuration: number
  indoorOutdoor: "indoor" | "outdoor" | "both"
  whyRecommended: string
}

export async function getAIPicks(
  tripId: string,
  destination: string
): Promise<AIPick[]> {
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
    include: {
      travelers: { include: { traveler: true } },
      activities: { where: { status: { in: ["WISHLIST", "SCHEDULED"] } }, select: { name: true } },
    },
  })

  const hasKids = trip.travelers.some((t) => t.traveler.tags.includes("child"))
  const existingNames = trip.activities.map((a) => a.name)

  const prompt = `You are a travel expert for ${destination}. Suggest 10 unique activities/attractions that a visitor should consider.

Context:
- Travelers: ${trip.travelers.map((t) => `${t.traveler.name} (${t.traveler.tags.join(", ") || "adult"})`).join(", ") || "2 adults"}
- Trip dates: ${trip.startDate.toISOString().split("T")[0]} to ${trip.endDate.toISOString().split("T")[0]}
${hasKids ? "- IMPORTANT: Include family-friendly options" : ""}
${existingNames.length > 0 ? `- Already on their list (DO NOT repeat these): ${existingNames.join(", ")}` : ""}

For each activity, provide:
- name: Activity/attraction name (must be a real place or experience)
- description: 1-sentence description
- category: One of "museum", "park", "cultural", "food_tour", "nightlife", "family", "shopping", "tour", "landmark", "outdoor_adventure"
- estimatedDuration: Duration in minutes (30-240)
- indoorOutdoor: "indoor" | "outdoor" | "both"
- whyRecommended: 1 sentence on why this fits the group

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
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      }
    )

    clearTimeout(timeout)

    if (!response.ok) {
      console.error("[AI Picks] API error:", response.status)
      return []
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ""

    // Track usage
    const promptTokens = data.usage?.prompt_tokens || 0
    const completionTokens = data.usage?.completion_tokens || 0
    await logAIUsage({ userId, feature: "ai_picks", model, promptTokens, completionTokens }).catch(() => {})

    // Parse JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const picks: AIPick[] = JSON.parse(jsonMatch[0])
    return picks.filter((p) => p.name && p.description)
  } catch (err) {
    clearTimeout(timeout)
    console.error("[AI Picks] Error:", err)
    return []
  }
}
