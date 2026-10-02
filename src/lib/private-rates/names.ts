/**
 * PURE. Hotel-name sanity for captured Hilton quotes.
 *
 * The first extension release sometimes stored the card's price ("$317") as
 * the property name. These helpers decide when a stored or incoming name is
 * unusable and what to show instead. They never invent a name: the fallback
 * is a name already captured for the same property code, else the code.
 */

const MONEY_RE = /(US\$|USD|CA\$|CAD|A\$|AUD|MX\$|MXN|€|EUR|£|GBP|¥|JPY|\$)\s?\d/i

/** True when a name looks like money or a number rather than a hotel name. */
export function isMoneyLikeName(name: string | null | undefined): boolean {
  const t = (name ?? "").replace(/\s+/g, " ").trim()
  if (!t) return true
  if (MONEY_RE.test(t)) return true
  const letters = (t.match(/[A-Za-z\u00C0-\u024F]/g) ?? []).length
  if (letters < 3) return true
  const compact = t.replace(/\s+/g, "")
  const numeric = (compact.match(/[\d$€£¥.,%+\-/]/g) ?? []).length
  return numeric * 2 >= compact.length
}

/** A name that is only the property code (the extension's "no name found" signal). */
export function isCodeOnlyName(name: string | null | undefined, propertyCode: string): boolean {
  return (name ?? "").trim().toUpperCase() === propertyCode.trim().toUpperCase()
}

/** Needs replacing: money-like, or just the code (a better stored name may exist). */
export function needsBetterName(name: string | null | undefined, propertyCode: string): boolean {
  return isMoneyLikeName(name) || isCodeOnlyName(name, propertyCode)
}

/** Shown when nothing better than a synthetic "name:" code exists. */
export const UNNAMED_HOTEL = "Hilton hotel"

/** Last-resort display name for a property code. */
export function fallbackNameForCode(propertyCode: string): string {
  return propertyCode.startsWith("name:") ? UNNAMED_HOTEL : propertyCode
}

/**
 * Best name for a quote: the given one when usable; else a known good name for
 * the code; else (for a money-like name) the code; else the given code-only name.
 */
export function resolveHotelName(name: string | null | undefined, propertyCode: string, known: ReadonlyMap<string, string>): string {
  if (!needsBetterName(name, propertyCode)) return (name ?? "").trim()
  const k = known.get(propertyCode)
  if (k && !needsBetterName(k, propertyCode)) return k
  return fallbackNameForCode(propertyCode)
}

/** Map propertyCode → first usable name among rows. */
export function knownNamesByCode(rows: readonly { propertyCode: string; propertyName: string }[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of rows) {
    if (out.has(r.propertyCode)) continue
    if (!needsBetterName(r.propertyName, r.propertyCode)) out.set(r.propertyCode, r.propertyName.trim())
  }
  return out
}
