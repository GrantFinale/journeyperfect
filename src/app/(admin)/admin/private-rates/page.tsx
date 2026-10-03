import { adminListAudit, adminListPrivateRates } from "@/lib/actions/private-rates"
import { PrivateRatesAdminView } from "./private-rates-admin-view"

export const dynamic = "force-dynamic"

export default async function AdminPrivateRatesPage() {
  const [overview, audit] = await Promise.all([adminListPrivateRates(), adminListAudit(100)])
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Private Rates (Hilton Go, Marriott F&amp;F)</h1>
      <p className="text-sm text-gray-500 mb-6">
        Kill switch, per-user entitlement, sessions and the append-only audit log. See docs/plans/opportunity-discovery-engine.md §6.
      </p>
      <PrivateRatesAdminView overview={overview} audit={audit} />
    </div>
  )
}
