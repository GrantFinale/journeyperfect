"use client"

import { useEffect } from "react"

export function ReferralCaptureOnLogin({ code }: { code: string }) {
  useEffect(() => {
    if (code) {
      localStorage.setItem("jp_referral_code", code)
    }
  }, [code])

  return null
}
