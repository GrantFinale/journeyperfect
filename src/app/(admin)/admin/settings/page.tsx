import { getAdminConfigs } from "@/lib/actions/admin"
import { SettingsView } from "./settings-view"

export default async function SettingsPage() {
  const configs = await getAdminConfigs()

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>
      <SettingsView configs={configs.map((c) => ({ key: c.key, value: c.value }))} />
    </div>
  )
}
