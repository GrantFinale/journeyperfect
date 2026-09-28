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

/**
 * Write the usage row BEFORE a run so a per-user cap that counts rows cannot
 * be raced by concurrent requests. Returns the row id (null when the write
 * failed; usage logging is non-critical). Settle with `settleAIUsage`.
 */
export async function reserveAIUsage(data: { userId: string; feature: string; model: string }): Promise<string | null> {
  try {
    const row = await prisma.aIUsage.create({
      data: { userId: data.userId, feature: data.feature, model: data.model, tokens: 0, costUsd: 0 },
      select: { id: true },
    })
    return row.id
  } catch {
    return null
  }
}

export async function settleAIUsage(id: string | null, data: { model: string; promptTokens: number; completionTokens: number }) {
  if (!id) return
  const totalTokens = data.promptTokens + data.completionTokens
  const costUsd = (totalTokens / 1_000_000) * getModelCostPer1M(data.model)
  await prisma.aIUsage.update({ where: { id }, data: { tokens: totalTokens, costUsd } }).catch(() => {})
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
