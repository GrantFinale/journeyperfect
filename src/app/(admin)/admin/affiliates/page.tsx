import { getAdminConfigs } from "@/lib/actions/admin"
import { AffiliateConfigForm } from "./affiliate-config-form"

const AFFILIATE_PROGRAMS = [
  { key: "affiliate.booking.id", name: "Booking.com (via Awin)", description: "Hotels, flights, cars — 4-6% commission. Enter your Awin publisher ID.", signupUrl: "https://ui.awin.com/merchant/6776/profile", icon: "🏨" },
  { key: "affiliate.rentalcars.id", name: "RentalCars.com", description: "Car rentals — up to 8% commission", signupUrl: "https://www.rentalcars.com/affiliates", icon: "🚗" },
  { key: "affiliate.viator.pid", name: "Viator", description: "Tours & activities — 8% commission", signupUrl: "https://www.viator.com/affiliates", icon: "🎟️" },
  { key: "affiliate.getyourguide.id", name: "GetYourGuide", description: "Tours & activities — 8% commission", signupUrl: "https://partner.getyourguide.com", icon: "🗺️" },
  { key: "affiliate.safetywing.id", name: "SafetyWing", description: "Travel insurance — 10% commission", signupUrl: "https://safetywing.com/affiliates", icon: "🛡️" },
  { key: "affiliate.amazon.tag", name: "Amazon Associates", description: "Travel essentials — up to 4% commission", signupUrl: "https://affiliate-program.amazon.com", icon: "🎒" },
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
