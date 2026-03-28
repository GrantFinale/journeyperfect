"use client"

import { useState, useRef, useEffect } from "react"
import { Calendar, Download, Link2, Check, ChevronDown } from "lucide-react"
import { toast } from "sonner"

// Simple SVG icons for calendar services
function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function OutlookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 7.387v10.478c0 .23-.08.424-.238.576-.158.154-.352.23-.584.23h-8.547v-8.07l1.387 1.02L17.4 10.6l6.186-4.47c.157.107.27.25.335.425.064.174.08.354.08.545v.287zM23.178 5.33c.134.1.235.223.303.368H15.63v-.013L14 7.023l-1.63-1.338H7.48V2.55c0-.238.08-.437.24-.598.158-.16.353-.24.583-.24h14.394c.16 0 .303.04.428.118l.052.04v3.5zM14.63 6.682L24 13.322v-.008l-9.37-6.632zm-1.26 0L4 13.314v-.008l9.37-6.624zM13.37 12.01l-5.5-4.017V2.687h.017L14 7.456l6.113-4.77h.017v5.308l-5.5 4.017-.63.46-.63-.46zM1 5.3c0-.423.137-.773.412-1.05.275-.277.618-.416 1.03-.416h4.638V6.05L.63 10.6l.13.087v-.06L1 10.78V5.3zm0 7.2l5.5 3.898.63.46.63-.46L13.26 12l.37.27.37-.27 5.5 3.898.63.46.63-.46L21 15.84v5.61c0 .238-.08.437-.24.598-.157.16-.352.24-.582.24H1.442c-.23 0-.424-.08-.583-.24A.818.818 0 01.62 21.45V12.5z" fill="#0078D4"/>
    </svg>
  )
}

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

  function getFullUrl() {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    return origin + calendarUrl
  }

  function getWebcalUrl() {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    return origin.replace(/^https?:/, "webcal:") + calendarUrl
  }

  function handleAppleCalendar() {
    window.location.href = getWebcalUrl()
    setOpen(false)
  }

  function handleGoogleCalendar() {
    const webcalUrl = getWebcalUrl()
    const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`
    window.open(googleUrl, "_blank")
    setOpen(false)
  }

  function handleOutlook() {
    const fullUrl = getFullUrl()
    const outlookUrl = `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(fullUrl)}&name=Trip%20Itinerary`
    window.open(outlookUrl, "_blank")
    setOpen(false)
  }

  function handleCopyUrl() {
    navigator.clipboard.writeText(getFullUrl())
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
        <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1">
          {/* Apple Calendar */}
          <button
            onClick={handleAppleCalendar}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
          >
            <AppleIcon className="w-4 h-4 text-gray-700" />
            <div className="text-left">
              <div className="text-sm font-medium text-gray-900">Add to Apple Calendar</div>
              <div className="text-xs text-gray-500">Subscribe via webcal://</div>
            </div>
          </button>

          {/* Google Calendar */}
          <button
            onClick={handleGoogleCalendar}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
          >
            <GoogleIcon className="w-4 h-4" />
            <div className="text-left">
              <div className="text-sm font-medium text-gray-900">Add to Google Calendar</div>
              <div className="text-xs text-gray-500">Subscribe with live sync</div>
            </div>
          </button>

          {/* Outlook */}
          <button
            onClick={handleOutlook}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
          >
            <OutlookIcon className="w-4 h-4" />
            <div className="text-left">
              <div className="text-sm font-medium text-gray-900">Add to Outlook</div>
              <div className="text-xs text-gray-500">Subscribe via Outlook web</div>
            </div>
          </button>

          <div className="border-t border-gray-100 my-1" />

          {/* Download .ics */}
          <a
            href={calendarUrl}
            download
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
            onClick={() => setOpen(false)}
          >
            <Download className="w-4 h-4 text-gray-500" />
            <div>
              <div className="text-sm font-medium text-gray-900">Download .ics</div>
              <div className="text-xs text-gray-500">One-time import file</div>
            </div>
          </a>

          {/* Copy URL */}
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

  function getWebcalUrl() {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    return origin.replace(/^https?:/, "webcal:") + calendarUrl
  }

  function handleAppleCalendar() {
    window.location.href = getWebcalUrl()
  }

  function handleGoogleCalendar() {
    const webcalUrl = getWebcalUrl()
    const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`
    window.open(googleUrl, "_blank")
  }

  function handleOutlook() {
    const fullUrl = getFullUrl()
    const outlookUrl = `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(fullUrl)}&name=Trip%20Itinerary`
    window.open(outlookUrl, "_blank")
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
        <button
          onClick={handleAppleCalendar}
          className="flex items-center gap-3 w-full px-4 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          <AppleIcon className="w-4 h-4" />
          Add to Apple Calendar
        </button>

        <button
          onClick={handleGoogleCalendar}
          className="flex items-center gap-3 w-full px-4 py-3 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium"
        >
          <GoogleIcon className="w-4 h-4" />
          Add to Google Calendar
        </button>

        <button
          onClick={handleOutlook}
          className="flex items-center gap-3 w-full px-4 py-3 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium"
        >
          <OutlookIcon className="w-4 h-4" />
          Add to Outlook
        </button>

        <div className="border-t border-gray-100 my-2" />

        <a
          href={calendarUrl}
          download
          className="flex items-center gap-3 w-full px-4 py-3 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium"
        >
          <Download className="w-4 h-4" />
          Download .ics file
        </a>

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
