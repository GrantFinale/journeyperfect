"use client"

import { useState } from "react"
import type { DayForecast, WeatherAlert, WeatherAlertSeverity } from "@/lib/weather"
import { X, CloudRain, AlertTriangle, Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface WeatherBarProps {
  forecasts: DayForecast[]
  tripStart: string
  tripEnd: string
  alerts: WeatherAlert[]
}

function alertBg(severity: WeatherAlertSeverity) {
  switch (severity) {
    case "danger":
      return "bg-red-50 border-red-200 text-red-800"
    case "warning":
      return "bg-amber-50 border-amber-200 text-amber-800"
    case "info":
      return "bg-blue-50 border-blue-200 text-blue-800"
  }
}

function alertIcon(severity: WeatherAlertSeverity) {
  switch (severity) {
    case "danger":
      return <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
    case "warning":
      return <CloudRain className="w-4 h-4 text-amber-500 shrink-0" />
    case "info":
      return <Info className="w-4 h-4 text-blue-500 shrink-0" />
  }
}

function hasAlertForDate(alerts: WeatherAlert[], date: string): WeatherAlertSeverity | null {
  for (const alert of alerts) {
    if (alert.affectedDates?.includes(date)) {
      return alert.severity
    }
  }
  return null
}

export function WeatherBar({ forecasts, tripStart, tripEnd, alerts }: WeatherBarProps) {
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set())

  const visibleAlerts = alerts.filter((a) => !dismissedAlerts.has(a.id))

  function dismissAlert(id: string) {
    setDismissedAlerts((prev) => new Set([...prev, id]))
  }

  if (forecasts.length === 0 && alerts.length === 0) return null

  return (
    <div className="mb-6">
      {/* Forecast day cards */}
      {forecasts.length > 0 && <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 pb-2">
        <div className="flex gap-2 min-w-min">
          {forecasts.map((day) => {
            const alertSeverity = hasAlertForDate(alerts, day.date)
            return (
              <div
                key={day.date}
                className="flex flex-col items-center bg-white border border-gray-100 rounded-xl px-3 py-2.5 min-w-[72px] hover:border-gray-200 transition-colors relative"
              >
                {/* Alert dot */}
                {alertSeverity && (
                  <div
                    className={cn(
                      "absolute top-1.5 right-1.5 w-2 h-2 rounded-full",
                      alertSeverity === "danger" ? "bg-red-500" : "bg-amber-400"
                    )}
                  />
                )}
                <span className="text-[11px] font-medium text-gray-500">{day.dayName}</span>
                <span className="text-[10px] text-gray-400">
                  {day.date.slice(5).replace("-", "/")}
                </span>
                <span className="text-xl my-0.5">{day.emoji}</span>
                <span className="text-xs font-semibold text-gray-900">
                  {day.highTemp}&deg;
                </span>
                <span className="text-[10px] text-gray-400">
                  {day.lowTemp}&deg;
                </span>
                {day.precipitationPct > 0 && (
                  <span
                    className={cn(
                      "text-[10px] mt-0.5 font-medium",
                      day.precipitationPct >= 60
                        ? "text-blue-600"
                        : day.precipitationPct >= 30
                          ? "text-blue-400"
                          : "text-gray-400"
                    )}
                  >
                    {day.precipitationPct}%
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>}

      {/* Alert banners */}
      {visibleAlerts.length > 0 && (
        <div className="space-y-2 mt-3">
          {visibleAlerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                "flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-sm",
                alertBg(alert.severity)
              )}
            >
              {alertIcon(alert.severity)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight">{alert.message}</p>
                {alert.suggestion && (
                  <p className="text-xs opacity-75 mt-0.5">{alert.suggestion}</p>
                )}
              </div>
              <button
                onClick={() => dismissAlert(alert.id)}
                className="p-0.5 opacity-50 hover:opacity-100 transition-opacity shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
