"use server"

export interface OpenRouterModel {
  id: string
  name: string
  promptCost: number
  completionCost: number
  contextLength: number
  tier: "cheap" | "mid" | "expensive"
}

export async function getOpenRouterModels(): Promise<OpenRouterModel[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return []

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 3600 },
    })

    if (!res.ok) return []

    const data = await res.json()
    const models: OpenRouterModel[] = []

    for (const m of data.data || []) {
      const promptCost = parseFloat(m.pricing?.prompt || "0")
      const completionCost = parseFloat(m.pricing?.completion || "0")
      if (promptCost <= 0) continue

      models.push({
        id: m.id,
        name: m.name || m.id,
        promptCost,
        completionCost,
        contextLength: m.context_length || 0,
        tier: "cheap",
      })
    }

    models.sort((a, b) => a.promptCost - b.promptCost)

    const third = Math.floor(models.length / 3)
    for (let i = 0; i < models.length; i++) {
      if (i < third) models[i].tier = "cheap"
      else if (i < third * 2) models[i].tier = "mid"
      else models[i].tier = "expensive"
    }

    return models
  } catch {
    return []
  }
}
