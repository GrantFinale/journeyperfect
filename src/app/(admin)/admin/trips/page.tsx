import { getAdminTrips } from "@/lib/actions/admin"
import { TripsTable } from "./trips-table"

export default async function AdminTripsPage() {
  const trips = await getAdminTrips()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Trips</h1>
        <p className="text-sm text-gray-500 mt-1">Manage all user trips</p>
      </div>
      <TripsTable initialTrips={trips} />
    </div>
  )
}
