import { getAdminConfigs } from "@/lib/actions/admin"
import { PLANS } from "@/lib/plans"
import { PlansForm } from "./plans-form"

export default async function PlansPage() {
  const configs = await getAdminConfigs()
  const configMap = Object.fromEntries(configs.map((c) => [c.key, c.value]))

  const planKeys = Object.keys(PLANS) as (keyof typeof PLANS)[]
  const planData = planKeys.map((key) => {
    const defaults = PLANS[key]
    return {
      key,
      name: defaults.name,
      maxTrips: Number(configMap[`plan.${key}.maxTrips`] ?? defaults.maxTrips),
      maxTravelersPerTrip: Number(configMap[`plan.${key}.maxTravelersPerTrip`] ?? defaults.maxTravelersPerTrip),
      canShare: configMap[`plan.${key}.canShare`] !== undefined
        ? configMap[`plan.${key}.canShare`] === "true"
        : defaults.canShare,
    }
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Plan Limits</h1>
      <PlansForm plans={planData} />
    </div>
  )
}
