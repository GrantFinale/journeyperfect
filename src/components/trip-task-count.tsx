"use client"

import { createContext, useContext, useEffect } from "react"

/**
 * Plumbing for the To Do nav badge.
 *
 * `AppShell` renders the nav, but it lives in `(app)/layout.tsx` — above the
 * trip segment — so it never sees a `tripId` param and can't fetch the count
 * itself. The trip layout, which does have the param, fetches the count on the
 * server and hands it upward through this context: no client-side request, and
 * no DB round trip added to client-side navigation.
 */

export type TripTaskCountValue = { tripId: string; count: number } | null

type SetTripTaskCount = (value: TripTaskCountValue) => void

const SetTripTaskCountContext = createContext<SetTripTaskCount | null>(null)

export function TripTaskCountProvider({
  setCount,
  children,
}: {
  setCount: SetTripTaskCount
  children: React.ReactNode
}) {
  return (
    <SetTripTaskCountContext.Provider value={setCount}>{children}</SetTripTaskCountContext.Provider>
  )
}

/**
 * Rendered (invisibly) by the trip layout with a server-computed count. Clears
 * itself on unmount so leaving the trip — or switching to another one — can't
 * leave a stale badge behind.
 */
export function TripTaskCountSync({ tripId, count }: { tripId: string; count: number }) {
  const setCount = useContext(SetTripTaskCountContext)

  useEffect(() => {
    if (!setCount) return
    setCount({ tripId, count })
    return () => setCount(null)
  }, [setCount, tripId, count])

  return null
}
