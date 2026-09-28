import { getAdminConfigs } from "@/lib/actions/admin"
import { CONFIG_KEYS, CONFIG_KEY_LIST } from "@/lib/config-keys"
import { SettingsView } from "./settings-view"

export default async function SettingsPage() {
  const configs = await getAdminConfigs()
  // Serialise the documented keys here (server) so the client view never
  // imports config-keys.ts, which pulls in Prisma via getConfig.
  const knownKeys = CONFIG_KEY_LIST.map((key) => {
    const def = CONFIG_KEYS[key]
    return { key, default: def.default, group: def.group, desc: def.desc, secret: "secret" in def && def.secret === true }
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>
      <SettingsView configs={configs.map((c) => ({ key: c.key, value: c.value }))} knownKeys={knownKeys} />
    </div>
  )
}
