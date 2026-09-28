import { getPrivateRateStatus } from "@/lib/actions/private-rates"
import { PrivateRatesView } from "./private-rates-view"

export const dynamic = "force-dynamic"

/**
 * /settings/private-rates — reached only by direct link (nothing in the main
 * nav points here; see docs/plans/opportunity-discovery-engine.md §6.1 rule 5).
 * Renders a plain "not available" notice unless the feature is enabled and the
 * user is entitled.
 */
export default async function PrivateRatesSettingsPage() {
  const status = await getPrivateRateStatus()

  if (!status.enabled || !status.entitled) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Private rates</h1>
        <p className="text-sm text-gray-600">This feature is not available on your account.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Hilton Go rates</h1>
      <p className="text-sm text-gray-500 mb-6">Connect your own Hilton account so JourneyPerfect can check Team Member rates when you ask it to.</p>
      <PrivateRatesView initial={status} />
    </div>
  )
}
