import { getAdminConfigs } from "@/lib/actions/admin"
import { AffiliateConfigForm } from "./affiliate-config-form"

const AFFILIATE_PROGRAMS = [
  { key: "affiliate.booking.id", name: "Booking.com (via Awin)", description: "Hotels, flights, cars — 4-6% commission. Enter your Awin publisher ID. Also covers car rentals.", dashboardUrl: "https://ui.awin.com/awin/reports/advertiser", icon: "🏨" },
  { key: "affiliate.viator.pid", name: "Viator", description: "Tours & activities — 8% commission", dashboardUrl: "https://partners.viator.com/reporting/commissions", icon: "🎟️" },
  { key: "affiliate.getyourguide.id", name: "GetYourGuide", description: "Tours & activities — 8% commission", dashboardUrl: "https://partner.getyourguide.com/reporting", icon: "🗺️" },
  { key: "affiliate.safetywing.id", name: "SafetyWing", description: "Travel insurance — 10% commission", dashboardUrl: "https://safetywing.com/affiliates/dashboard", icon: "🛡️" },
  { key: "affiliate.amazon.tag", name: "Amazon Associates", description: "Travel essentials — up to 4% commission", dashboardUrl: "https://affiliate-program.amazon.com/home/reports", icon: "🎒" },
]

export default async function AffiliateAdminPage() {
  const configs = await getAdminConfigs()

  // getAdminConfigs returns an array of { key, value } — convert to a lookup map
  const configMap: Record<string, string> = {}
  for (const c of configs) {
    configMap[c.key] = c.value
  }

  const programs = AFFILIATE_PROGRAMS.map(p => ({
    ...p,
    currentValue: configMap[p.key] || "",
    isConfigured: !!configMap[p.key],
  }))

  const configured = programs.filter(p => p.isConfigured).length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Affiliate Programs</h1>
          <p className="text-sm text-gray-500 mt-1">{configured} of {programs.length} programs configured</p>
        </div>
      </div>
      <AffiliateConfigForm programs={programs} />
    </div>
  )
}
