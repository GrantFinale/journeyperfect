import { Suspense } from "react"
import { getTripTaskCount } from "@/lib/actions/trip-tasks"
import { TripTaskCountSync } from "@/components/trip-task-count"

/**
 * Feeds the To Do badge in the app nav. `AppShell` sits above this layout and
 * has no `tripId`, so the count is fetched here — on the server, once per trip
 * layout render — and pushed up through context. Wrapped in Suspense so the
 * page never waits on it.
 */
async function TripTaskCountLoader({ tripId }: { tripId: string }) {
  const count = await getTripTaskCount(tripId).catch(() => 0)
  return <TripTaskCountSync tripId={tripId} count={count} />
}

export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tripId: string }>
}) {
  const { tripId } = await params

  return (
    <>
      <Suspense fallback={null}>
        <TripTaskCountLoader tripId={tripId} />
      </Suspense>
      {children}
    </>
  )
}
