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
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Private hotel rates</h1>
      <p className="text-sm text-gray-500 mb-6">
        Your Go Hilton and Marriott Friends &amp; Family rates, read from your own browser when you ask, compared with the public rates for the same hotels.
      </p>
      <PrivateRatesView initial={status} />
    </div>
  )
}
