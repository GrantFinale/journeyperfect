"use client"

import { useEffect, useState } from "react"
import { checkFlightStatus, type FlightStatus } from "@/lib/actions/flight-alerts"
import { cn } from "@/lib/utils"
import { Plane, AlertTriangle, CheckCircle, XCircle, Clock } from "lucide-react"

interface FlightStatusBadgeProps {
  flightNumber: string
  departureDate: string // YYYY-MM-DD
}

function statusConfig(status: FlightStatus["status"]) {
  switch (status) {
    case "scheduled":
      return {
        label: "On time",
        color: "bg-green-50 text-green-700 border-green-200",
        icon: CheckCircle,
      }
    case "active":
      return {
        label: "In flight",
        color: "bg-blue-50 text-blue-700 border-blue-200",
        icon: Plane,
      }
    case "landed":
      return {
        label: "Landed",
        color: "bg-gray-50 text-gray-700 border-gray-200",
        icon: CheckCircle,
      }
    case "delayed":
      return {
        label: "Delayed",
        color: "bg-amber-50 text-amber-700 border-amber-200",
        icon: Clock,
      }
    case "cancelled":
      return {
        label: "Cancelled",
        color: "bg-red-50 text-red-700 border-red-200",
        icon: XCircle,
      }
    case "diverted":
      return {
        label: "Diverted",
        color: "bg-orange-50 text-orange-700 border-orange-200",
        icon: AlertTriangle,
      }
    default:
      return {
        label: "Unknown",
        color: "bg-gray-50 text-gray-500 border-gray-200",
        icon: Clock,
      }
  }
}

export function FlightStatusBadge({ flightNumber, departureDate }: FlightStatusBadgeProps) {
  const [status, setStatus] = useState<FlightStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchStatus() {
      try {
        const result = await checkFlightStatus(flightNumber, departureDate)
        if (!cancelled) setStatus(result)
      } catch {
        // Silently fail — badge just won't show
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchStatus()

    // Refresh every 5 minutes
    const interval = setInterval(fetchStatus, 5 * 60 * 1000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [flightNumber, departureDate])

  if (loading || !status) return null

  const config = statusConfig(status.status)
  const Icon = config.icon

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border",
          config.color
        )}
      >
        <Icon className="w-2.5 h-2.5" />
        {config.label}
        {status.delayMinutes && status.delayMinutes > 0 && ` ${status.delayMinutes}m`}
      </span>
      {status.departureGate && (
        <span className="text-[10px] text-gray-500">
          Gate {status.departureTerminal ? `${status.departureTerminal}/` : ""}
          {status.departureGate}
        </span>
      )}
    </div>
  )
}
