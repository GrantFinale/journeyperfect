import { getAdminConfigs } from "@/lib/actions/admin"
import { AiConfigForm } from "./ai-config-form"

export default async function AiConfigPage() {
  const configs = await getAdminConfigs()
  const configMap = Object.fromEntries(configs.map((c) => [c.key, c.value]))

  const hasOpenRouterKey = !!process.env.OPENROUTER_API_KEY

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">AI Model Configuration</h1>
      <AiConfigForm
        hasOpenRouterKey={hasOpenRouterKey}
        flightParserModel={configMap["ai.flightParserModel"] ?? "anthropic/claude-haiku-4-5-20251001"}
      />
    </div>
  )
}
