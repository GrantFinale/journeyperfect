import { getAdminStats, getApiStatuses, getDeployments, type Deployment } from "@/lib/actions/admin"
import Link from "next/link"

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffSec = Math.floor((now - then) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  return `${diffDays}d ago`
}

function deploymentStyle(phase: string) {
  switch (phase) {
    case "ACTIVE":
      return { dot: "bg-green-500", bg: "border-green-200 bg-green-50", text: "text-green-700" }
    case "BUILDING":
    case "DEPLOYING":
    case "PENDING_BUILD":
    case "PENDING_DEPLOY":
      return { dot: "bg-yellow-500", bg: "border-yellow-200 bg-yellow-50", text: "text-yellow-700" }
    case "ERROR":
    case "CANCELED":
      return { dot: "bg-red-500", bg: "border-red-200 bg-red-50", text: "text-red-700" }
    case "SUPERSEDED":
      return { dot: "bg-gray-400", bg: "border-gray-200 bg-gray-50", text: "text-gray-600" }
    default:
      return { dot: "bg-gray-400", bg: "border-gray-200 bg-gray-50", text: "text-gray-600" }
  }
}

export default async function AdminOverviewPage() {
  const [stats, apiStatuses, deployments] = await Promise.all([
    getAdminStats(),
    getApiStatuses(),
    getDeployments(),
  ])

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

      {/* Deployments */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Deployments</h2>
        {deployments === null ? (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-gray-50 border border-gray-200">
            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-gray-500">Set DIGITALOCEAN_API_TOKEN to see deployment status</p>
          </div>
        ) : deployments.length === 0 ? (
          <p className="text-sm text-gray-500">Failed to fetch deployments</p>
        ) : (
          <div className="space-y-2">
            {deployments.map((d) => {
              const style = deploymentStyle(d.phase)
              const cause = d.cause.length > 80 ? d.cause.slice(0, 80) + "…" : d.cause
              return (
                <div
                  key={d.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${style.bg}`}
                >
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${style.dot}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${style.text}`}>{d.phase}</p>
                    <p className="text-xs text-gray-600 truncate">{cause || "No description"}</p>
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
                    {relativeTime(d.updated_at || d.created_at)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
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
