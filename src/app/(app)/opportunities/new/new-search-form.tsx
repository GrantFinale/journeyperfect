"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format, addDays } from "date-fns"
import { Loader2, Plus, X, Plane, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { createOpportunitySearch, runOpportunitySearch } from "@/lib/actions/opportunities"
import type { SearchConstraints } from "@/lib/opportunities/types"
import { WEEKDAY_PATTERNS } from "../format"

export type HomeAirport = { iata: string; name: string; distanceKm: number }
export type TravelerOption = { id: string; name: string; age: number | null; isDefault?: boolean }

const REGION_OPTIONS = [
  "Florida",
  "Caribbean",
  "Mexico",
  "Southwest",
  "California",
  "Hawaii",
  "Southeast",
  "Northeast",
  "Mountain West",
  "Pacific Northwest",
  "Canada",
  "Europe",
]

const IATA_RE = /^[A-Z]{3}$/

const inputClass =
  "w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"

export function NewSearchForm({
  homeAirports,
  travelers,
}: {
  homeAirports: HomeAirport[]
  travelers: TravelerOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [phase, setPhase] = useState<"idle" | "creating" | "running">("idle")

  const today = useMemo(() => new Date(), [])
  const [windowStart, setWindowStart] = useState(format(addDays(today, 7), "yyyy-MM-dd"))
  const [windowEnd, setWindowEnd] = useState(format(addDays(today, 49), "yyyy-MM-dd"))
  const [nightsMin, setNightsMin] = useState(3)
  const [nightsMax, setNightsMax] = useState(4)
  const [weekdayPattern, setWeekdayPattern] = useState("")

  const [selectedAirports, setSelectedAirports] = useState<string[]>(() =>
    homeAirports.slice(0, 2).map((a) => a.iata)
  )
  const [extraAirports, setExtraAirports] = useState<string[]>([])
  const [airportDraft, setAirportDraft] = useState("")

  const [selectedTravelers, setSelectedTravelers] = useState<string[]>(() => {
    const defaults = travelers.filter((t) => t.isDefault).map((t) => t.id)
    return defaults.length > 0 ? defaults : travelers.map((t) => t.id)
  })

  const [nonstopOnly, setNonstopOnly] = useState(true)
  const [warm, setWarm] = useState(false)
  const [drivingOk, setDrivingOk] = useState(false)
  const [maxFlightHours, setMaxFlightHours] = useState<string>("")
  const [maxCoreCost, setMaxCoreCost] = useState<string>("")
  const [regions, setRegions] = useState<string[]>([])

  const allAirports = [...selectedAirports, ...extraAirports]

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  const addAirport = () => {
    const code = airportDraft.trim().toUpperCase()
    if (!IATA_RE.test(code)) {
      toast.error("Enter a 3-letter airport code, like DTW")
      return
    }
    if (allAirports.includes(code)) {
      setAirportDraft("")
      return
    }
    if (homeAirports.some((a) => a.iata === code)) {
      setSelectedAirports([...selectedAirports, code])
    } else {
      setExtraAirports([...extraAirports, code])
    }
    setAirportDraft("")
  }

  const validate = (): string | null => {
    if (allAirports.length === 0) return "Pick at least one home airport"
    if (!windowStart || !windowEnd) return "Pick a date window"
    if (windowEnd < windowStart) return "The window must end after it starts"
    if (nightsMin < 1 || nightsMax < nightsMin) return "Nights: minimum must be at least 1 and no more than the maximum"
    if (selectedTravelers.length === 0) return "Pick at least one traveler"
    return null
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }

    const constraints: SearchConstraints = {
      nonstopOnly,
      warm: warm || undefined,
      drivingOk: drivingOk || undefined,
      maxFlightMins: maxFlightHours ? Math.round(Number(maxFlightHours) * 60) : undefined,
      maxCoreCost: maxCoreCost ? Number(maxCoreCost) : undefined,
      regions: regions.length > 0 ? regions.map((r) => r.toLowerCase().replace(/\s+/g, "-")) : undefined,
    }

    startTransition(async () => {
      try {
        setPhase("creating")
        const created = await createOpportunitySearch({
          originAirports: allAirports,
          windowStart,
          windowEnd,
          nightsMin,
          nightsMax,
          weekdayPattern: weekdayPattern || null,
          travelerProfileIds: selectedTravelers,
          constraints,
        })
        if ("error" in created) {
          toast.error(created.error)
          setPhase("idle")
          return
        }
        setPhase("running")
        try {
          const run = await runOpportunitySearch(created.searchId)
          if (run.opportunityCount === 0 && run.status !== "FAILED") {
            toast.message("Nothing stood out in that window", {
              description: "Try a wider window, more airports, or fewer constraints.",
            })
          }
        } catch (err) {
          // The search exists even if the run failed; land on it so the user can re-run.
          toast.error(err instanceof Error ? err.message : "The search didn't finish; you can re-run it.")
        }
        router.push(`/opportunities/${created.searchId}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't start the search")
        setPhase("idle")
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Home airports */}
      <Section title="Home airports" hint="Nonstop routes are searched from each one.">
        {homeAirports.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {homeAirports.map((a) => {
              const active = selectedAirports.includes(a.iata)
              return (
                <button
                  key={a.iata}
                  type="button"
                  onClick={() => toggle(selectedAirports, setSelectedAirports, a.iata)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors",
                    active
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  )}
                >
                  <Plane className="w-3.5 h-3.5" />
                  <span className="font-semibold">{a.iata}</span>
                  <span className="text-xs text-gray-500 max-w-[10rem] truncate">{a.name}</span>
                  <span className="text-xs text-gray-400">{Math.round(a.distanceKm * 0.621)} mi</span>
                </button>
              )
            })}
          </div>
        )}
        {extraAirports.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {extraAirports.map((code) => (
              <span
                key={code}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border border-indigo-500 bg-indigo-50 text-indigo-700"
              >
                <Plane className="w-3.5 h-3.5" />
                <span className="font-semibold">{code}</span>
                <button
                  type="button"
                  onClick={() => setExtraAirports(extraAirports.filter((c) => c !== code))}
                  className="text-indigo-400 hover:text-indigo-700"
                  aria-label={`Remove ${code}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={airportDraft}
            onChange={(e) => setAirportDraft(e.target.value.toUpperCase().slice(0, 3))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addAirport()
              }
            }}
            placeholder={homeAirports.length > 0 ? "Add another airport code" : "Airport code, e.g. DTW"}
            maxLength={3}
            className={cn(inputClass, "sm:max-w-xs uppercase")}
            aria-label="Airport code"
          />
          <button
            type="button"
            onClick={addAirport}
            className="inline-flex items-center gap-1 px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        {homeAirports.length === 0 && (
          <p className="text-xs text-gray-400 mt-2">
            Set a home address in Settings to get nearby airports suggested here.
          </p>
        )}
      </Section>

      {/* When */}
      <Section title="When" hint="Every weekend in this window is considered.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="From">
            <input
              type="date"
              value={windowStart}
              min={format(today, "yyyy-MM-dd")}
              onChange={(e) => setWindowStart(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={windowEnd}
              min={windowStart}
              onChange={(e) => setWindowEnd(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
          <Field label="Nights (min)">
            <input
              type="number"
              min={1}
              max={14}
              value={nightsMin}
              onChange={(e) => setNightsMin(Number(e.target.value))}
              className={inputClass}
            />
          </Field>
          <Field label="Nights (max)">
            <input
              type="number"
              min={nightsMin}
              max={21}
              value={nightsMax}
              onChange={(e) => setNightsMax(Number(e.target.value))}
              className={inputClass}
            />
          </Field>
          <Field label="Days" className="col-span-2 sm:col-span-1">
            <select
              value={weekdayPattern}
              onChange={(e) => setWeekdayPattern(e.target.value)}
              className={inputClass}
            >
              {WEEKDAY_PATTERNS.map((p) => (
                <option key={p.value || "any"} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {/* Who */}
      <Section title="Who's coming" hint="Ages and interests shape which destinations fit.">
        {travelers.length === 0 ? (
          <p className="text-sm text-gray-500">
            No traveler profiles yet.{" "}
            <a href="/settings/travelers" className="text-indigo-600 hover:underline">
              Add your travelers
            </a>{" "}
            first so I know who to plan for.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {travelers.map((t) => {
              const checked = selectedTravelers.includes(t.id)
              return (
                <label
                  key={t.id}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors",
                    checked ? "border-indigo-300 bg-indigo-50/50" : "border-gray-200 bg-white hover:border-gray-300"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(selectedTravelers, setSelectedTravelers, t.id)}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-gray-900 truncate">{t.name}</span>
                    {t.age != null && <span className="block text-xs text-gray-500">age {t.age}</span>}
                  </span>
                </label>
              )
            })}
          </div>
        )}
      </Section>

      {/* Constraints */}
      <Section title="Constraints" hint="Optional. Fewer constraints, more surprises.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
          <Toggle label="Nonstop only" checked={nonstopOnly} onChange={setNonstopOnly} />
          <Toggle label="Warm weather" checked={warm} onChange={setWarm} />
          <Toggle label="Driving is fine" checked={drivingOk} onChange={setDrivingOk} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <Field label="Max flight time (hours)">
            <input
              type="number"
              min={0.5}
              step={0.5}
              placeholder="Any"
              value={maxFlightHours}
              onChange={(e) => setMaxFlightHours(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Max core cost (party total, $)">
            <input
              type="number"
              min={0}
              step={50}
              placeholder="Any"
              value={maxCoreCost}
              onChange={(e) => setMaxCoreCost(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Regions">
          <div className="flex flex-wrap gap-2">
            {REGION_OPTIONS.map((r) => {
              const active = regions.includes(r)
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggle(regions, setRegions, r)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-sm border transition-colors",
                    active
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  )}
                >
                  {r}
                </button>
              )
            })}
          </div>
        </Field>
      </Section>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {phase === "creating" ? "Starting…" : phase === "running" ? "Searching…" : "Find opportunities"}
        </button>
        {phase === "running" && (
          <p className="text-sm text-gray-500">
            Checking routes, weather and fares across the window. This can take a minute.
          </p>
        )}
      </div>
    </form>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-100 rounded-2xl p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="block text-xs font-medium text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      className={cn(
        "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors text-sm",
        checked ? "border-indigo-300 bg-indigo-50/50 text-indigo-800" : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
      />
      {label}
    </label>
  )
}
