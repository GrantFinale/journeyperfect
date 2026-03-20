import { getMyReferralCode, getMyReferralStats } from "@/lib/actions/referrals"
import { ReferralDashboard } from "./referral-dashboard"

export default async function ReferralsPage() {
  const code = await getMyReferralCode()
  const { referrals, stats, config } = await getMyReferralStats()

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Refer a Friend</h1>
      <p className="text-sm text-gray-500 mb-6">
        Share your code. When they upgrade, you get rewarded.
      </p>
      <ReferralDashboard
        code={code}
        referrals={referrals}
        stats={stats}
        config={config}
      />
    </div>
  )
}
