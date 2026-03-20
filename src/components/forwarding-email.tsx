"use client"

import { useState } from "react"
import { Mail, Copy, Check, Sparkles } from "lucide-react"

interface ForwardingEmailProps {
  userId: string
  variant?: "compact" | "card"
}

export function ForwardingEmail({ userId, variant = "card" }: ForwardingEmailProps) {
  const [copied, setCopied] = useState(false)
  const email = `trips+${userId}@inbound.journeyperfect.com`

  function handleCopy() {
    navigator.clipboard.writeText(email).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (variant === "compact") {
    return (
      <button
        onClick={handleCopy}
        className="flex items-center gap-2 px-3 py-2 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors w-full text-left"
        title="Click to copy your forwarding email"
      >
        <Mail className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate font-mono">{email}</span>
        {copied ? (
          <span className="shrink-0 text-green-600 font-semibold flex items-center gap-0.5">
            <Check className="w-3 h-3" /> Copied!
          </span>
        ) : (
          <Copy className="w-3 h-3 shrink-0 opacity-50" />
        )}
      </button>
    )
  }

  // Card variant
  return (
    <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm">Let us figure it out</h3>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
            Forward your confirmation emails — flights, hotels, rental cars, restaurant reservations, event tickets — and we&apos;ll automatically add everything to your trip.
          </p>
          <button
            onClick={handleCopy}
            className="mt-3 flex items-center gap-2 px-4 py-2.5 bg-white border border-indigo-200 rounded-xl hover:bg-indigo-50 transition-colors group w-full sm:w-auto"
          >
            <Mail className="w-4 h-4 text-indigo-500 shrink-0" />
            <span className="font-mono text-sm text-gray-800 truncate">{email}</span>
            {copied ? (
              <span className="shrink-0 text-green-600 text-xs font-semibold flex items-center gap-1 ml-auto">
                <Check className="w-3.5 h-3.5" /> Copied!
              </span>
            ) : (
              <span className="shrink-0 text-indigo-400 text-xs ml-auto group-hover:text-indigo-600 flex items-center gap-1">
                <Copy className="w-3.5 h-3.5" /> Click to copy
              </span>
            )}
          </button>
          <p className="text-[10px] text-gray-400 mt-2">
            Works with United, Delta, American, Southwest, Booking.com, Hilton, Marriott, Enterprise, Hertz, OpenTable, and more.
          </p>
        </div>
      </div>
    </div>
  )
}
