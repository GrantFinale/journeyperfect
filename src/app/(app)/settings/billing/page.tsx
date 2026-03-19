import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { PLANS, type Plan } from "@/lib/plans"
import { redirect } from "next/navigation"
import { BillingClient } from "./billing-client"

export default async function BillingPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true, planStatus: true, subscription: true },
  })

  const plan = (user?.plan as Plan) ?? "FREE"
  const limits = PLANS[plan]

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground mt-1">Manage your plan and billing details.</p>
      </div>

      <div className="rounded-lg border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Current Plan</h2>
            <p className="text-2xl font-bold mt-1">{limits.name}</p>
          </div>
          {user?.planStatus && (
            <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
              {user.planStatus}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
          <div>
            <p className="text-sm text-muted-foreground">Trips</p>
            <p className="text-lg font-medium">
              {limits.maxTrips === 999 ? "Unlimited" : `Up to ${limits.maxTrips}`}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Travelers per trip</p>
            <p className="text-lg font-medium">
              {limits.maxTravelersPerTrip === 999 ? "Unlimited" : `Up to ${limits.maxTravelersPerTrip}`}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Sharing</p>
            <p className="text-lg font-medium">{limits.canShare ? "Enabled" : "Not available"}</p>
          </div>
        </div>
      </div>

      <BillingClient plan={plan} />

      {plan !== "FREE" && (
        <div className="rounded-lg border p-6 space-y-4">
          <h2 className="text-lg font-semibold">All Plans</h2>
          <div className="grid gap-3">
            {(Object.entries(PLANS) as [Plan, (typeof PLANS)[Plan]][]).map(([key, p]) => (
              <div
                key={key}
                className={`rounded-md border p-4 ${key === plan ? "border-primary bg-primary/5" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{p.name}</span>
                  {key === plan && (
                    <span className="text-xs font-medium text-primary">Current</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {p.maxTrips === 999 ? "Unlimited" : p.maxTrips} trips
                  {" · "}
                  {p.maxTravelersPerTrip === 999 ? "Unlimited" : p.maxTravelersPerTrip} travelers
                  {p.canShare ? " · Sharing" : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
