import { getAdminConfigs, getAIUsageStats } from "@/lib/actions/admin"
import { getOpenRouterModels } from "@/lib/actions/openrouter"
import { AiConfigDashboard } from "./ai-config-dashboard"

export default async function AiConfigPage() {
  const [configs, models, usageStats] = await Promise.all([
    getAdminConfigs(),
    getOpenRouterModels(),
    getAIUsageStats(30),
  ])
  const configMap = Object.fromEntries(configs.map((c) => [c.key, c.value]))

  const hasOpenRouterKey = !!process.env.OPENROUTER_API_KEY

  const aiFeatures = [
    {
      key: "ai.flightParserModel",
      feature: "flight_parser",
      label: "Flight Parser",
      description: "Parses flight confirmation emails into structured data",
      defaultModel: "anthropic/claude-haiku-4.5",
    },
    {
      key: "ai.hotelParserModel",
      feature: "hotel_parser",
      label: "Hotel Parser",
      description: "Parses hotel booking confirmations into structured data",
      defaultModel: "anthropic/claude-haiku-4.5",
    },
    {
      key: "ai.rentalCarParserModel",
      feature: "rental_car_parser",
      label: "Rental Car Parser",
      description: "Parses rental car booking confirmations into structured data",
      defaultModel: "anthropic/claude-haiku-4.5",
    },
    {
      key: "ai.optimizerModel",
      feature: "optimizer",
      label: "Itinerary Optimizer",
      description: "Optimizes daily itinerary scheduling with AI",
      defaultModel: "anthropic/claude-haiku-4.5",
    },
    {
      key: "ai.diningModel",
      feature: "dining_recs",
      label: "Dining Recommendations",
      description: "Generates restaurant recommendations for trip destinations",
      defaultModel: "anthropic/claude-haiku-4.5",
    },
    {
      key: "ai.packingModel",
      feature: "packing",
      label: "Packing Suggestions",
      description: "Generates personalized packing lists based on trip details",
      defaultModel: "anthropic/claude-haiku-4.5",
    },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">AI Model Configuration</h1>
      <AiConfigDashboard
        hasOpenRouterKey={hasOpenRouterKey}
        aiFeatures={aiFeatures.map((f) => ({
          ...f,
          currentModel: configMap[f.key] ?? f.defaultModel,
        }))}
        models={models}
        initialUsageStats={usageStats}
      />
    </div>
  )
}
