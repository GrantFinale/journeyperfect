import { getAdminConfigs } from "@/lib/actions/admin"
import { AffiliateConfigForm } from "./affiliate-config-form"

const AFFILIATE_PROGRAMS = [
  {
    key: "affiliate.booking.id", name: "Booking.com (via Awin)", icon: "🏨",
    description: "Hotels, flights, cars — 4-6% commission. Enter your Awin publisher ID.",
    links: [
      { label: "Earnings Report", url: "https://ui.awin.com/awin/reports/advertiser" },
      { label: "Click Report", url: "https://ui.awin.com/awin/reports/clicks" },
      { label: "Transaction Report", url: "https://ui.awin.com/awin/reports/transaction" },
      { label: "Account Settings", url: "https://ui.awin.com/awin/affiliate/settings" },
    ],
  },
  {
    key: "affiliate.viator.pid", name: "Viator", icon: "🎟️",
    description: "Tours & activities — 8% commission",
    links: [
      { label: "Commissions", url: "https://partners.viator.com/reporting/commissions" },
      { label: "Click Report", url: "https://partners.viator.com/reporting/clicks" },
      { label: "Tools & Links", url: "https://partners.viator.com/tools/overview" },
      { label: "Account", url: "https://partners.viator.com/account" },
    ],
  },
  {
    key: "affiliate.getyourguide.id", name: "GetYourGuide", icon: "🗺️",
    description: "Tours & activities — 8% commission",
    links: [
      { label: "Earnings", url: "https://partner.getyourguide.com/reporting" },
      { label: "Performance", url: "https://partner.getyourguide.com/reporting/performance" },
      { label: "Account", url: "https://partner.getyourguide.com/account" },
    ],
  },
  {
    key: "affiliate.safetywing.id", name: "SafetyWing", icon: "🛡️",
    description: "Travel insurance — 10% commission",
    links: [
      { label: "Dashboard", url: "https://safetywing.com/affiliates/dashboard" },
      { label: "Referrals", url: "https://safetywing.com/affiliates/referrals" },
    ],
  },
  {
    key: "affiliate.amazon.tag", name: "Amazon Associates", icon: "🎒",
    description: "Travel essentials — up to 4% commission",
    links: [
      { label: "Earnings", url: "https://affiliate-program.amazon.com/home/reports/earnings" },
      { label: "Orders", url: "https://affiliate-program.amazon.com/home/reports/orders" },
      { label: "Clicks", url: "https://affiliate-program.amazon.com/home/reports/clicks" },
      { label: "Link Checker", url: "https://affiliate-program.amazon.com/home/tools/linkchecker" },
    ],
  },
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
