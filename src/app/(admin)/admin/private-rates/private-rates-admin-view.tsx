"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import {
  adminGrantEntitlement,
  adminListAudit,
  adminListPrivateRates,
  adminRevokeEntitlement,
  adminSetKillSwitch,
} from "@/lib/actions/private-rates"

type Overview = Awaited<ReturnType<typeof adminListPrivateRates>>
type AuditRows = Awaited<ReturnType<typeof adminListAudit>>

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  AWAITING_LOGIN: "bg-blue-100 text-blue-800",
  NEEDS_USER: "bg-amber-100 text-amber-800",
  EXPIRED: "bg-gray-100 text-gray-700",
  REVOKED: "bg-red-100 text-red-800",
}

const PROVIDERS = [
  { id: "hilton", label: "Hilton Go" },
  { id: "marriott", label: "Marriott F&F" },
] as const
type ProviderId = (typeof PROVIDERS)[number]["id"]
const PROVIDER_LABEL: Record<string, string> = { hilton: "Hilton Go", marriott: "Marriott F&F" }

function when(isoStr: string | null | undefined): string {
  if (!isoStr) return "—"
  const d = new Date(isoStr)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString()
}

export function PrivateRatesAdminView({ overview: initialOverview, audit: initialAudit }: { overview: Overview; audit: AuditRows }) {
  const [overview, setOverview] = useState(initialOverview)
  const [audit, setAudit] = useState(initialAudit)
  const [email, setEmail] = useState("")
  const [notes, setNotes] = useState("")
  const [provider, setProvider] = useState<ProviderId>("hilton")
  const [isPending, startTransition] = useTransition()

  async function reload() {
    const [o, a] = await Promise.all([adminListPrivateRates(), adminListAudit(100)])
    setOverview(o)
    setAudit(a)
  }

  function toggleKillSwitch() {
    const next = !overview.enabled
    if (
      next &&
      !window.confirm("Turn private rates ON? Entitled users will be able to connect Hilton and run rate checks.")
    )
      return
    startTransition(async () => {
      try {
        await adminSetKillSwitch(next)
        toast.success(next ? "Private rates enabled." : "Private rates disabled.")
        await reload()
      } catch {
        toast.error("Could not update the kill switch.")
      }
    })
  }

  function grant(e: React.FormEvent) {
    e.preventDefault()
    const target = email.trim()
    if (!target) return
    startTransition(async () => {
      const res = await adminGrantEntitlement(target, notes, provider)
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      toast.success(`${PROVIDER_LABEL[res.provider]} entitlement granted to ${res.email}.`)
      setEmail("")
      setNotes("")
      await reload()
    })
  }

  function revoke(userId: string, userEmail: string, entProvider: string) {
    const label = PROVIDER_LABEL[entProvider] ?? entProvider
    const consequence = entProvider === "hilton" ? " Their Hilton session and sealed profile will be destroyed." : ""
    if (!window.confirm(`Revoke ${label} for ${userEmail}?${consequence}`)) return
    startTransition(async () => {
      const res = await adminRevokeEntitlement(userId, entProvider)
      if ("error" in res) toast.error(res.error)
      else toast.success(`Revoked ${label} for ${userEmail}.`)
      await reload()
    })
  }

  const active = overview.entitlements.filter((e) => !e.revokedAt)
  const revoked = overview.entitlements.filter((e) => e.revokedAt)

  return (
    <div className="space-y-8">
      {/* Kill switch */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Kill switch</h2>
            <p className="text-sm text-gray-500 mt-1">
              <code className="text-xs">privateRates.enabled</code> — off disables every private-rate action, including runs in progress at their next checkpoint.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleKillSwitch}
            disabled={isPending}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
              overview.enabled ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {overview.enabled ? "Turn OFF" : "Turn ON"}
          </button>
        </div>
        <p className={`mt-3 text-sm font-medium ${overview.enabled ? "text-green-700" : "text-gray-600"}`}>
          Currently {overview.enabled ? "ENABLED" : "disabled"}
        </p>
      </section>

      {/* Entitlements */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900">Entitlements</h2>
        <p className="text-sm text-gray-500 mt-1">
          Per user and per program, admin-granted, not a plan tier and not purchasable. Marriott F&amp;F also needs{" "}
          <code className="text-xs">privateRates.marriott.rateCode</code>:{" "}
          <span className={overview.marriottRateCodeSet ? "text-green-700" : "text-amber-700"}>
            {overview.marriottRateCodeSet ? "set" : "not set"}
          </span>
          .
        </p>

        <form onSubmit={grant} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
            aria-label="Program"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={isPending || !email.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            Grant
          </button>
        </form>

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-3">User</th>
              <th className="py-2 pr-3">Program</th>
              <th className="py-2 pr-3">Granted</th>
              <th className="py-2 pr-3">Notes</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {active.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-gray-500">
                  No one is entitled.
                </td>
              </tr>
            )}
            {active.map((e) => (
              <tr key={e.id} className="border-b border-gray-100">
                <td className="py-2 pr-3">
                  <div className="font-medium text-gray-900">{e.email}</div>
                  {e.name && <div className="text-xs text-gray-500">{e.name}</div>}
                </td>
                <td className="py-2 pr-3 text-gray-600">{PROVIDER_LABEL[e.provider] ?? e.provider}</td>
                <td className="py-2 pr-3 text-gray-600">{when(e.grantedAt)}</td>
                <td className="py-2 pr-3 text-gray-600">{e.notes ?? "—"}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => revoke(e.userId, e.email, e.provider)}
                    disabled={isPending}
                    className="text-red-600 hover:text-red-800 disabled:opacity-60"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {revoked.length > 0 && (
          <p className="mt-3 text-xs text-gray-400">
            Revoked: {revoked.map((e) => `${e.email}, ${PROVIDER_LABEL[e.provider] ?? e.provider} (${when(e.revokedAt)})`).join("; ")}
          </p>
        )}
      </section>

      {/* Sessions */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900">Sessions</h2>
        <p className="text-sm text-gray-500 mt-1">Metadata only. The sealed browser profile lives on the runner; no credentials are stored anywhere.</p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-3">User</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Challenge</th>
              <th className="py-2 pr-3">Validated</th>
              <th className="py-2 pr-3">Last used</th>
              <th className="py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {overview.sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-gray-500">
                  No sessions.
                </td>
              </tr>
            )}
            {overview.sessions.map((s) => (
              <tr key={s.id} className="border-b border-gray-100">
                <td className="py-2 pr-3 text-gray-900">{s.email}</td>
                <td className="py-2 pr-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[s.status] ?? "bg-gray-100 text-gray-700"}`}>{s.status}</span>
                </td>
                <td className="py-2 pr-3 text-gray-600">{s.challengeKind ?? "—"}</td>
                <td className="py-2 pr-3 text-gray-600">{when(s.lastValidatedAt)}</td>
                <td className="py-2 pr-3 text-gray-600">{when(s.lastUsedAt)}</td>
                <td className="py-2 text-gray-600">{when(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Audit */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900">Audit log</h2>
        <p className="text-sm text-gray-500 mt-1">Append-only. Latest {audit.length} entries.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Program</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Search</th>
                <th className="py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-gray-500">
                    Nothing yet.
                  </td>
                </tr>
              )}
              {audit.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-600">{when(row.createdAt)}</td>
                  <td className="py-2 pr-3 text-gray-900">{row.email ?? row.userId}</td>
                  <td className="py-2 pr-3 text-xs text-gray-600">{row.provider}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-gray-800">{row.action}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-gray-500">{row.searchId ? row.searchId.slice(0, 8) : "—"}</td>
                  <td className="py-2 font-mono text-xs text-gray-600 break-all">{row.detail ? JSON.stringify(row.detail) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
