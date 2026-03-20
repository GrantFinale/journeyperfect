export const RENTAL_CAR_COMPANIES: Record<string, { name: string; color: string; logo: string }> = {
  enterprise: { name: "Enterprise", color: "#007A33", logo: "\uD83D\uDFE2" },
  hertz: { name: "Hertz", color: "#FFD700", logo: "\uD83D\uDFE1" },
  avis: { name: "Avis", color: "#CC0000", logo: "\uD83D\uDD34" },
  budget: { name: "Budget", color: "#FF6600", logo: "\uD83D\uDFE0" },
  national: { name: "National", color: "#006400", logo: "\uD83D\uDFE2" },
  alamo: { name: "Alamo", color: "#003366", logo: "\uD83D\uDD35" },
  dollar: { name: "Dollar", color: "#CC0000", logo: "\uD83D\uDD34" },
  thrifty: { name: "Thrifty", color: "#0066CC", logo: "\uD83D\uDD35" },
  sixt: { name: "Sixt", color: "#FF6600", logo: "\uD83D\uDFE0" },
  turo: { name: "Turo", color: "#593CFB", logo: "\uD83D\uDFE3" },
  zipcar: { name: "Zipcar", color: "#4CAF50", logo: "\uD83D\uDFE2" },
}

export function getCompanyInfo(companyName: string) {
  const key = Object.keys(RENTAL_CAR_COMPANIES).find(k =>
    companyName.toLowerCase().includes(k)
  )
  return key ? RENTAL_CAR_COMPANIES[key] : { name: companyName, color: "#6B7280", logo: "\uD83D\uDE97" }
}
