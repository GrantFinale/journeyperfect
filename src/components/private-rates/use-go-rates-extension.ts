"use client"

import { useEffect, useState } from "react"

/** Retry window for the content script to mark the page (it may load after hydration). */
const DETECT_RETRY_MS = 250
const DETECT_GIVE_UP_MS = 3_000

function present(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.jpGoRates === "1"
}

/**
 * True once the JourneyPerfect Go Rates extension's content script has set
 * `document.documentElement.dataset.jpGoRates = "1"`. Checked after mount,
 * retried for a few seconds, and watched for later changes.
 */
export function useGoRatesExtension(): { detected: boolean; checking: boolean } {
  const [detected, setDetected] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (present()) {
      setDetected(true)
      setChecking(false)
      return
    }
    const started = Date.now()
    const timer = setInterval(() => {
      if (present()) {
        setDetected(true)
        setChecking(false)
        clearInterval(timer)
      } else if (Date.now() - started >= DETECT_GIVE_UP_MS) {
        setChecking(false)
        clearInterval(timer)
      }
    }, DETECT_RETRY_MS)
    const observer = new MutationObserver(() => {
      if (present()) {
        setDetected(true)
        setChecking(false)
      }
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-jp-go-rates"] })
    return () => {
      clearInterval(timer)
      observer.disconnect()
    }
  }, [])

  return { detected, checking }
}
