"use client"

import { useState, useRef, useEffect } from "react"
import { Calendar, Download, Link2, Check, ChevronDown } from "lucide-react"
import { toast } from "sonner"

export function CalendarExportButton({ tripId }: { tripId: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  const calendarUrl = `/api/trip/${tripId}/calendar`

  function handleSubscribe() {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    const webcalUrl = origin.replace(/^https?:/, "webcal:") + calendarUrl
    window.location.href = webcalUrl
    setOpen(false)
  }

  function handleCopyUrl() {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    const fullUrl = origin + calendarUrl
    navigator.clipboard.writeText(fullUrl)
    setCopied(true)
    toast.success("Calendar URL copied")
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        title="Export to Calendar"
      >
        <Calendar className="w-5 h-5" />
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1">
          <a
            href={calendarUrl}
            download
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
            onClick={() => setOpen(false)}
          >
            <Download className="w-4 h-4 text-gray-500" />
            <div>
              <div className="text-sm font-medium text-gray-900">Download .ics</div>
              <div className="text-xs text-gray-500">One-time import</div>
            </div>
          </a>
          <button
            onClick={handleSubscribe}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
          >
            <Calendar className="w-4 h-4 text-gray-500" />
            <div className="text-left">
              <div className="text-sm font-medium text-gray-900">Subscribe</div>
              <div className="text-xs text-gray-500">Live sync via webcal://</div>
            </div>
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button
            onClick={handleCopyUrl}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Link2 className="w-4 h-4 text-gray-500" />
            )}
            <div className="text-left">
              <div className="text-sm font-medium text-gray-900">
                {copied ? "Copied!" : "Copy calendar URL"}
              </div>
              <div className="text-xs text-gray-500">Paste into any calendar app</div>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}

/** Inline card variant for settings/sharing pages */
export function CalendarExportCard({ tripId }: { tripId: string }) {
  const [copied, setCopied] = useState(false)

  const calendarUrl = `/api/trip/${tripId}/calendar`

  function getFullUrl() {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    return origin + calendarUrl
  }

  function handleSubscribe() {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    const webcalUrl = origin.replace(/^https?:/, "webcal:") + calendarUrl
    window.location.href = webcalUrl
  }

  function handleCopy() {
    navigator.clipboard.writeText(getFullUrl())
    setCopied(true)
    toast.success("Calendar URL copied")
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <h3 className="font-semibold text-gray-900 mb-1">Calendar Export</h3>
      <p className="text-sm text-gray-500 mb-4">
        Add your trip itinerary to Apple Calendar, Google Calendar, Outlook, or any calendar app.
      </p>

      <div className="space-y-2">
        <a
          href={calendarUrl}
          download
          className="flex items-center gap-3 w-full px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors text-sm font-medium"
        >
          <Download className="w-4 h-4" />
          Download .ics file
        </a>

        <button
          onClick={handleSubscribe}
          className="flex items-center gap-3 w-full px-4 py-3 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium"
        >
          <Calendar className="w-4 h-4" />
          Subscribe (live sync)
        </button>

        <div className="flex items-center gap-2 mt-3">
          <input
            type="text"
            readOnly
            value={getFullUrl()}
            className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 truncate"
          />
          <button
            onClick={handleCopy}
            className="shrink-0 px-3 py-2 border border-gray-200 rounded-xl text-xs text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Link2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
