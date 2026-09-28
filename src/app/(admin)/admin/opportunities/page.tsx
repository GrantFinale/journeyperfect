import { OpportunitiesAdminView } from "./opportunities-admin-view"

export const dynamic = "force-dynamic"

export default function AdminOpportunitiesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Opportunities</h1>
      <p className="text-sm text-gray-500 mb-6">
        Reference data for the Opportunity Discovery Engine. See docs/plans/opportunity-discovery-engine.md §8.
      </p>
      <OpportunitiesAdminView />
    </div>
  )
}
