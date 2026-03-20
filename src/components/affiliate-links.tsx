"use client"

import { useState, useEffect, useCallback } from "react"
import type { AffiliateLink } from "@/lib/affiliates"
import { getActivityAffiliates } from "@/lib/actions/affiliates"
import { X, Car, Plane, Hotel } from "lucide-react"

// Track which booking type the user clicked so we can prompt on return
type BookingType = "car" | "hotel" | "flight"

function trackAffiliateClick(type: BookingType, tripId?: string) {
  try {
    localStorage.setItem("jp_affiliate_click", JSON.stringify({
      type,
      tripId,
      timestamp: Date.now(),
    }))
  } catch {}
}

export function getAffiliateClickReturn(): { type: BookingType; tripId?: string } | null {
  try {
    const raw = localStorage.getItem("jp_affiliate_click")
    if (!raw) return null
    const data = JSON.parse(raw)
    // Only valid for 2 hours
    if (Date.now() - data.timestamp > 2 * 60 * 60 * 1000) {
      localStorage.removeItem("jp_affiliate_click")
      return null
    }
    return data
  } catch {
    return null
  }
}

export function clearAffiliateClick() {
  try { localStorage.removeItem("jp_affiliate_click") } catch {}
}

// Compact inline link (for activity cards, hotel cards)
export function AffiliateBadge({ link, trackType, tripId }: { link: AffiliateLink; trackType?: BookingType; tripId?: string }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackType && trackAffiliateClick(trackType, tripId)}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-full transition-colors"
    >
      <span>{link.icon}</span>
      {link.label}
      <svg
        className="w-3 h-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </a>
  )
}

// Prompt shown when user returns after clicking a booking affiliate link
export function BookingReturnPrompt({ tripId }: { tripId: string }) {
  const [clickData, setClickData] = useState<{ type: BookingType; tripId?: string } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const check = () => {
      const data = getAffiliateClickReturn()
      if (data && (!data.tripId || data.tripId === tripId)) {
        setClickData(data)
      }
    }
    check()
    window.addEventListener("focus", check)
    return () => window.removeEventListener("focus", check)
  }, [tripId])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    clearAffiliateClick()
  }, [])

  if (!clickData || dismissed) return null

  const config = {
    car: {
      icon: <Car className="w-5 h-5" />,
      title: "Just booked a rental car?",
      description: "Paste your confirmation email to automatically add pickup/dropoff details, price, and more to your trip.",
      settingsTab: "cars",
      buttonText: "Add rental car details",
      color: "bg-emerald-50 border-emerald-200 text-emerald-900",
    },
    hotel: {
      icon: <Hotel className="w-5 h-5" />,
      title: "Just booked a hotel?",
      description: "Paste your confirmation email to automatically add check-in/out dates, room details, and price to your trip.",
      settingsTab: "hotels",
      buttonText: "Add hotel details",
      color: "bg-blue-50 border-blue-200 text-blue-900",
    },
    flight: {
      icon: <Plane className="w-5 h-5" />,
      title: "Just booked a flight?",
      description: "Paste your confirmation email to automatically add all flight segments to your trip.",
      settingsTab: "flights",
      buttonText: "Add flight details",
      color: "bg-indigo-50 border-indigo-200 text-indigo-900",
    },
  }

  const c = config[clickData.type]

  return (
    <div className={`flex items-start gap-3 px-4 py-4 rounded-xl border ${c.color}`}>
      <span className="mt-0.5 flex-shrink-0">{c.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{c.title}</p>
        <p className="text-xs opacity-75 mt-0.5">{c.description}</p>
        <div className="flex items-center gap-3 mt-3">
          <a
            href={`/trip/${tripId}/settings?tab=${c.settingsTab}`}
            onClick={() => clearAffiliateClick()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white rounded-lg border border-current/20 hover:bg-white/80 transition-colors"
          >
            {c.buttonText} →
          </a>
          <button onClick={handleDismiss} className="text-xs opacity-50 hover:opacity-75">
            No thanks
          </button>
        </div>
      </div>
      <button onClick={handleDismiss} className="opacity-40 hover:opacity-70 flex-shrink-0 p-1">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

// Smart contextual affiliate suggestions (for trip dashboard)
export interface SmartSuggestion {
  id: string
  icon: string
  title: string
  description: string
  link: AffiliateLink
  variant: "blue" | "green" | "amber" | "purple"
  trackType?: BookingType
}

export function AffiliateSmartSuggestions({ suggestions, tripId }: { suggestions: SmartSuggestion[]; tripId?: string }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = suggestions.filter(s => !dismissed.has(s.id))
  if (visible.length === 0) return null

  return (
    <div className="space-y-3">
      {visible.map((s) => {
        const colors = {
          blue: "bg-blue-50 border-blue-100 text-blue-800",
          green: "bg-emerald-50 border-emerald-100 text-emerald-800",
          amber: "bg-amber-50 border-amber-100 text-amber-800",
          purple: "bg-purple-50 border-purple-100 text-purple-800",
        }
        return (
          <div key={s.id} className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${colors[s.variant]}`}>
            <span className="text-xl mt-0.5 flex-shrink-0">{s.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{s.title}</p>
              <p className="text-xs opacity-75 mt-0.5">{s.description}</p>
              <a
                href={s.link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => s.trackType && trackAffiliateClick(s.trackType, tripId)}
                className="inline-flex items-center gap-1 mt-2 text-xs font-semibold hover:underline"
              >
                {s.link.label}
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              </a>
            </div>
            <button onClick={() => setDismissed(prev => new Set(prev).add(s.id))} className="text-current opacity-40 hover:opacity-70 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// Activity-specific booking links (fetches on mount)
export function ActivityBookingLinks({
  activityName,
  destination,
}: {
  activityName: string
  destination: string
}) {
  const [links, setLinks] = useState<AffiliateLink[]>([])

  useEffect(() => {
    let cancelled = false
    getActivityAffiliates(activityName, destination).then((result) => {
      if (!cancelled) setLinks(result)
    })
    return () => {
      cancelled = true
    }
  }, [activityName, destination])

  if (links.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {links.map((link) => (
        <AffiliateBadge key={link.provider} link={link} />
      ))}
    </div>
  )
}

