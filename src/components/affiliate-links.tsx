"use client"

import { useState, useEffect } from "react"
import type { AffiliateLink } from "@/lib/affiliates"
import { getActivityAffiliates } from "@/lib/actions/affiliates"
import { X } from "lucide-react"

// Compact inline link (for activity cards, hotel cards)
export function AffiliateBadge({ link }: { link: AffiliateLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
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

// Smart contextual affiliate suggestions (for trip dashboard)
interface SmartSuggestion {
  id: string
  icon: string
  title: string
  description: string
  link: AffiliateLink
  variant: "blue" | "green" | "amber" | "purple"
}

export function AffiliateSmartSuggestions({ suggestions }: { suggestions: SmartSuggestion[] }) {
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

