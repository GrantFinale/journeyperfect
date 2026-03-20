export const CURRENCIES = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "\u20ac", name: "Euro" },
  { code: "GBP", symbol: "\u00a3", name: "British Pound" },
  { code: "CAD", symbol: "CA$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "JPY", symbol: "\u00a5", name: "Japanese Yen" },
  { code: "MXN", symbol: "MX$", name: "Mexican Peso" },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc" },
  { code: "CNY", symbol: "\u00a5", name: "Chinese Yuan" },
  { code: "INR", symbol: "\u20b9", name: "Indian Rupee" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real" },
  { code: "THB", symbol: "\u0e3f", name: "Thai Baht" },
  { code: "KRW", symbol: "\u20a9", name: "South Korean Won" },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
] as const

export type CurrencyCode = (typeof CURRENCIES)[number]["code"]

// Free exchange rate API (no key needed)
let rateCache: { rates: Record<string, number>; fetched: number } | null = null

export async function getExchangeRates(
  baseCurrency: string = "USD"
): Promise<Record<string, number>> {
  // Cache for 6 hours
  if (rateCache && Date.now() - rateCache.fetched < 6 * 60 * 60 * 1000) {
    return rateCache.rates
  }

  try {
    // Using free frankfurter.app API (no key needed, ECB data)
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=${baseCurrency}`
    )
    if (!res.ok) return {}
    const data = await res.json()
    const rates = { [baseCurrency]: 1, ...data.rates }
    rateCache = { rates, fetched: Date.now() }
    return rates
  } catch {
    return { USD: 1 }
  }
}

export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>
): number {
  if (from === to) return amount
  const fromRate = rates[from] || 1
  const toRate = rates[to] || 1
  return (amount / fromRate) * toRate
}

export function formatCurrencyAmount(
  amount: number,
  currency: string
): string {
  const curr = CURRENCIES.find((c) => c.code === currency)
  if (currency === "JPY" || currency === "KRW") {
    return `${curr?.symbol || currency}${Math.round(amount).toLocaleString()}`
  }
  return `${curr?.symbol || currency}${amount.toFixed(2)}`
}
