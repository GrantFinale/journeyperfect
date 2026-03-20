"use client"

import { useState, useEffect } from "react"
import type { AffiliateLink } from "@/lib/affiliates"
import { getActivityAffiliates } from "@/lib/actions/affiliates"

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

// Full affiliate bar (for trip dashboard sidebar)
export function AffiliateBar({ links }: { links: AffiliateLink[] }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || links.length === 0) return null

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-xl border border-indigo-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Book for your trip
        </h3>
        <button
          onClick={() => setDismissed(true)}
          className="text-gray-400 hover:text-gray-600 text-xs"
        >
          Dismiss
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {links.map((link) => (
          <a
            key={link.provider}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2.5 bg-white rounded-lg border border-gray-100 hover:border-indigo-200 hover:shadow-sm transition-all text-sm"
          >
            <span className="text-lg">{link.icon}</span>
            <div className="min-w-0">
              <p className="font-medium text-gray-900 truncate">
                {link.provider}
              </p>
              <p className="text-xs text-gray-500 truncate">{link.label}</p>
            </div>
          </a>
        ))}
      </div>
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

// Static activity booking links (when links are already fetched server-side)
export function ActivityBookingLinksStatic({
  links,
}: {
  links: AffiliateLink[]
}) {
  if (links.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {links.map((link) => (
        <AffiliateBadge key={link.provider} link={link} />
      ))}
    </div>
  )
}
