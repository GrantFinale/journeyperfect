import { prisma } from "./db"

export async function logAIUsage(data: {
  userId: string
  feature: string
  model: string
  promptTokens: number
  completionTokens: number
}) {
  const totalTokens = data.promptTokens + data.completionTokens
  // Rough cost estimation based on model
  const costPer1M = getModelCostPer1M(data.model)
  const costUsd = (totalTokens / 1_000_000) * costPer1M

  await prisma.aIUsage.create({
    data: {
      userId: data.userId,
      feature: data.feature,
      model: data.model,
      tokens: totalTokens,
      costUsd,
    },
  }).catch(() => {}) // non-critical, don't fail the request
}

function getModelCostPer1M(model: string): number {
  // Rough estimates per 1M tokens (prompt + completion averaged)
  if (model.includes("haiku")) return 0.50
  if (model.includes("sonnet")) return 4.00
  if (model.includes("opus")) return 20.00
  if (model.includes("gpt-4o-mini")) return 0.30
  if (model.includes("gpt-4o")) return 5.00
  if (model.includes("gpt-4")) return 30.00
  if (model.includes("gemini-flash")) return 0.15
  if (model.includes("gemini-pro")) return 3.50
  if (model.includes("llama")) return 0.20
  if (model.includes("mistral")) return 0.50
  return 1.00 // default
}
