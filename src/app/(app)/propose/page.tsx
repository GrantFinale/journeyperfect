import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { hasFeature, getUpgradeMessage } from "@/lib/features"
import { ProposeView } from "./propose-view"

export const dynamic = "force-dynamic"

export default async function ProposePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true, homeCity: true, homeAddress: true },
  })

  const allowed = !!user && hasFeature(user.plan, "aiTripProposals")

  return (
    <ProposeView
      allowed={allowed}
      upgradeMessage={allowed ? null : getUpgradeMessage("aiTripProposals")}
      aiConfigured={!!process.env.OPENROUTER_API_KEY}
      defaultOrigin={user?.homeCity ?? user?.homeAddress ?? ""}
    />
  )
}
