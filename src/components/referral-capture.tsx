"use client"

import { useEffect } from "react"
import { applyReferralCode } from "@/lib/actions/referrals"

export function ReferralCapture() {
  useEffect(() => {
    const code = localStorage.getItem("jp_referral_code")
    if (!code) return

    applyReferralCode(code)
      .then(() => {
        localStorage.removeItem("jp_referral_code")
      })
      .catch(() => {
        // silently fail — user might not be new or code might be invalid
      })
  }, [])

  return null
}
