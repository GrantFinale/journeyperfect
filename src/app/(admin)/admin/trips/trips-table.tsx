"use client"

import { useState, useTransition } from "react"
import { getAdminTrips, deleteAdminTrip } from "@/lib/actions/admin"

type Trip = {
  id: string
  title: string
  destination: string
  startDate: Date
  endDate: Date
  status: string
  createdAt: Date
  user: { name: string | null; email: string }
  _count: { itineraryItems: number; flights: number }
}

export function TripsTable({ initialTrips }: { initialTrips: Trip[] }) {
  const [trips, setTrips] = useState(initialTrips)
  const [search, setSearch] = useState("")
  const [isPending, startTransition] = useTransition()

  function handleSearch(value: string) {
    setSearch(value)
    startTransition(async () => {
      const results = await getAdminTrips({ search: value || undefined })
      setTrips(results)
    })
  }

  function handleDelete(tripId: string, title: string) {
    if (!confirm(`Delete trip '${title}'? This cannot be undone.`)) return
    startTransition(async () => {
      await deleteAdminTrip(tripId)
      setTrips((prev) => prev.filter((t) => t.id !== tripId))
    })
  }

  function formatDate(date: Date) {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const statusColors: Record<string, string> = {
    PLANNING: "bg-yellow-100 text-yellow-700",
    ACTIVE: "bg-green-100 text-green-700",
    COMPLETED: "bg-blue-100 text-blue-700",
    CANCELLED: "bg-red-100 text-red-700",
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Search by title or destination..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Trip Title</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Destination</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">User</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Dates</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700"># Items</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700"># Flights</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Created</th>
              <th className="text-right px-4 py-3 font-medium text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {trips.map((trip) => (
              <tr key={trip.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-medium text-gray-900">{trip.title}</td>
                <td className="px-4 py-3 text-gray-600">{trip.destination}</td>
                <td className="px-4 py-3">
                  <div>
                    <div className="text-gray-900">{trip.user.name || "—"}</div>
                    <div className="text-xs text-gray-500">{trip.user.email}</div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                  {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
                </td>
                <td className="px-4 py-3 text-gray-600">{trip._count.itineraryItems}</td>
                <td className="px-4 py-3 text-gray-600">{trip._count.flights}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColors[trip.status] || "bg-gray-100 text-gray-700"}`}
                  >
                    {trip.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(trip.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDelete(trip.id, trip.title)}
                    disabled={isPending}
                    className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {trips.length === 0 && (
          <p className="text-center py-8 text-gray-500 text-sm">No trips found</p>
        )}
      </div>
      {isPending && (
        <div className="text-center text-sm text-gray-400">Loading...</div>
      )}
    </div>
  )
}
