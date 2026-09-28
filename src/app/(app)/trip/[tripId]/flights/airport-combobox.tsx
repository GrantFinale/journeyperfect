"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { PlaneLanding, PlaneTakeoff } from "lucide-react"
import { AIRPORT_COORDS } from "@/lib/airports"
import { cn } from "@/lib/utils"

export type AirportEntry = { code: string; name: string; city: string }

const ENTRIES: AirportEntry[] = Object.entries(AIRPORT_COORDS)
  .map(([code, a]) => ({ code, name: a.name, city: a.city }))
  .sort((a, b) => a.city.localeCompare(b.city))

const MAX_RESULTS = 8
const IATA = /^[A-Z]{3}$/

/**
 * Rank airports for a typed query: exact code, code prefix, city prefix, name
 * prefix, then any substring. Exported so it can be unit-tested without React.
 */
export function matchAirports(query: string, limit = MAX_RESULTS): AirportEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { e: AirportEntry; score: number }[] = []
  for (const e of ENTRIES) {
    const code = e.code.toLowerCase()
    const city = e.city.toLowerCase()
    const name = e.name.toLowerCase()
    let score = -1
    if (code === q) score = 0
    else if (code.startsWith(q)) score = 1
    else if (city.startsWith(q)) score = 2
    else if (name.startsWith(q)) score = 3
    else if (city.includes(q) || name.includes(q)) score = 4
    if (score >= 0) scored.push({ e, score })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.e.city.localeCompare(b.e.city))
    .slice(0, limit)
    .map((s) => s.e)
}

interface AirportComboboxProps {
  label: string
  /** IATA code, or "" when nothing valid has been entered. */
  value: string
  onChange: (code: string) => void
  direction: "from" | "to"
  placeholder?: string
}

/**
 * A small IATA picker over the static airport table. Typing a city or airport
 * name offers matches; typing any three letters is accepted as a code even if
 * we don't know the airport, so a regional field missing from the table still
 * works. The controlled `value` is always a code or empty.
 */
export function AirportCombobox({ label, value, onChange, direction, placeholder }: AirportComboboxProps) {
  const listId = useId()
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the visible text in step when the parent changes the code (a suggested
  // route, a swap, or opening a saved search) without clobbering what is being typed.
  useEffect(() => {
    if (value && value !== text.trim().toUpperCase()) setText(value)
    if (!value && IATA.test(text.trim().toUpperCase())) setText("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const results = useMemo(() => matchAirports(text), [text])
  const typedCode = text.trim().toUpperCase()
  const known = IATA.test(typedCode) ? AIRPORT_COORDS[typedCode] : undefined
  const Icon = direction === "from" ? PlaneTakeoff : PlaneLanding

  function commit(entry: AirportEntry) {
    setText(entry.code)
    onChange(entry.code)
    setOpen(false)
  }

  function handleInput(next: string) {
    setText(next)
    setOpen(true)
    setActive(0)
    const code = next.trim().toUpperCase()
    onChange(IATA.test(code) ? code : "")
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      if (e.key === "ArrowDown" && results.length > 0) setOpen(true)
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const pick = results[active]
      if (pick) commit(pick)
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div className="relative min-w-0">
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          value={text}
          placeholder={placeholder ?? "City or airport code"}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current)
            if (text) setOpen(true)
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120)
          }}
          onKeyDown={handleKeyDown}
          className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <p className="mt-1 h-4 text-[11px] text-gray-400 truncate">
        {known
          ? `${known.name}, ${known.city}`
          : IATA.test(typedCode)
            ? "Using this airport code"
            : text && results.length === 0
              ? "No match — enter a 3-letter code"
              : " "}
      </p>

      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-0.5 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg"
        >
          {results.map((r, i) => (
            <li
              key={r.code}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => commit(r)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-sm cursor-pointer",
                i === active ? "bg-indigo-50 text-indigo-900" : "text-gray-700 hover:bg-gray-50"
              )}
            >
              <span className="w-10 shrink-0 font-semibold tabular-nums tracking-wide">{r.code}</span>
              <span className="flex-1 min-w-0 truncate">
                {r.city}
                <span className="text-gray-400"> · {r.name}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
