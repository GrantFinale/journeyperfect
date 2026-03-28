"use client"

import { useState, useEffect } from "react"

const STORAGE_KEY = "jp_plan_onboarding_seen"

export function DragOnboarding({ onDismiss }: { onDismiss?: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY)
    if (!seen) {
      setVisible(true)
    }
  }, [])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1")
    setVisible(false)
    onDismiss?.()
  }

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]"
      onClick={dismiss}
    >
      <div
        className="relative bg-white rounded-2xl shadow-xl p-8 max-w-sm mx-4 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hand-drawn arrow */}
        <div className="flex items-center justify-center mb-4">
          <svg width="180" height="60" viewBox="0 0 180 60" fill="none" className="text-indigo-400">
            <path
              d="M160 10 C130 5, 80 15, 40 30 C25 36, 15 42, 10 50"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="6 4"
              fill="none"
            />
            {/* Arrowhead */}
            <path
              d="M10 50 L18 46 L13 40"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {/* Hand icon at start */}
            <text x="155" y="18" fontSize="20">👆</text>
          </svg>
        </div>

        <p
          className="text-xl text-indigo-700 mb-1 leading-relaxed"
          style={{ fontFamily: "'Caveat', 'Segoe Script', 'Comic Sans MS', cursive" }}
        >
          Drag activities over here to plan your days!
        </p>
        <p className="text-sm text-gray-500 mb-5">
          Grab items from your wishlist and drop them onto any day.
        </p>
        <button
          onClick={dismiss}
          className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  )
}

export function markOnboardingSeen() {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, "1")
  }
}

export function hasSeenOnboarding(): boolean {
  if (typeof window === "undefined") return true
  return !!localStorage.getItem(STORAGE_KEY)
}
