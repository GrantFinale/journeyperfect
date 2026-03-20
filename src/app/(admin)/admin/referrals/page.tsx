import { getAdminConfigs } from "@/lib/actions/admin"
import { prisma } from "@/lib/db"
import { ReferralAdminConfig } from "./referral-admin-config"

export default async function AdminReferralsPage() {
  const configs = await getAdminConfigs()
  const configMap: Record<string, string> = {}
  for (const c of configs) {
    configMap[c.key] = c.value
  }

  const referrals = await prisma.referral.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      referrer: { select: { name: true, email: true } },
      referee: { select: { name: true, email: true, plan: true } },
    },
  })

  const stats = {
    total: referrals.length,
    signedUp: referrals.filter((r) => r.status !== "PENDING").length,
    converted: referrals.filter((r) =>
      ["CONVERTED", "REWARDED"].includes(r.status)
    ).length,
    rewarded: referrals.filter((r) => r.status === "REWARDED").length,
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Referral Program</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure referral rewards and view all referrals
        </p>
      </div>

      <ReferralAdminConfig
        configMap={configMap}
        referrals={referrals.map((r) => ({
          id: r.id,
          code: r.code,
          status: r.status,
          rewardGiven: r.rewardGiven,
          createdAt: r.createdAt.toISOString(),
          convertedAt: r.convertedAt?.toISOString() || null,
          referrerName: r.referrer.name || r.referrer.email,
          refereeName: r.referee?.name || r.referee?.email || null,
          refereePlan: r.referee?.plan || null,
        }))}
        stats={stats}
      />
    </div>
  )
}
