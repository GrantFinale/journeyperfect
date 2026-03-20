import { getAdminStats, getApiStatuses } from "@/lib/actions/admin"
import Link from "next/link"

export default async function AdminOverviewPage() {
  const [stats, apiStatuses] = await Promise.all([getAdminStats(), getApiStatuses()])

  const cards = [
    { label: "Total Users", value: stats.totalUsers, href: "/admin/users" },
    { label: "Total Trips", value: stats.totalTrips, href: undefined },
    { label: "Active Trips", value: stats.activeTrips, href: undefined },
  ]

  const navCards = [
    { label: "AI Models", description: "Configure AI model settings and API keys", href: "/admin/ai" },
    { label: "Plan Limits", description: "Manage plan quotas and features", href: "/admin/plans" },
    { label: "Users", description: "View and manage user accounts", href: "/admin/users" },
    { label: "Settings", description: "Feature flags and app configuration", href: "/admin/settings" },
  ]

  const configuredCount = apiStatuses.filter((s) => s.configured).length

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin Overview</h1>

      {/* API Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">API Configuration</h2>
          <span className="text-sm text-gray-500">
            {configuredCount}/{apiStatuses.length} configured
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {apiStatuses.map((api) => (
            <div
              key={api.name}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                api.configured
                  ? "border-green-200 bg-green-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  api.configured ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <div className="min-w-0">
                <p className={`text-sm font-medium ${api.configured ? "text-green-900" : "text-red-900"}`}>
                  {api.name}
                </p>
                <p className={`text-xs truncate ${api.configured ? "text-green-600" : "text-red-600"}`}>
                  {api.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-lg border border-gray-200 p-5">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{card.value}</p>
            {card.href && (
              <Link href={card.href} className="text-sm text-indigo-600 hover:text-indigo-800 mt-2 inline-block">
                View all &rarr;
              </Link>
            )}
          </div>
        ))}
      </div>

      <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Links</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {navCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="bg-white rounded-lg border border-gray-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <p className="font-medium text-gray-900">{card.label}</p>
            <p className="text-sm text-gray-500 mt-1">{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
