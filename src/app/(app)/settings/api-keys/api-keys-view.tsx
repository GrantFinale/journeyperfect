"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Check, Copy, KeyRound, Plus, ShieldAlert, Trash2, X } from "lucide-react"
import { createApiKey, revokeApiKey } from "@/lib/actions/api-keys"

export interface ApiKeyRow {
  id: string
  name: string
  prefix: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

interface Props {
  initialKeys: ApiKeyRow[]
  canUseMcp: boolean
  mcpUrl: string
}

const KEY_PLACEHOLDER = "<key>"

function formatDate(iso: string | null): string {
  if (!iso) return "Never"
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : "Something went wrong"
  // Server actions prefix machine-readable codes: "UPGRADE_REQUIRED:..." etc.
  const idx = message.indexOf(":")
  return idx > 0 && /^[A-Z_]+$/.test(message.slice(0, idx)) ? message.slice(idx + 1).trim() : message
}

function CopyButton({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard can be unavailable (insecure context, permissions); the text
      // is on screen so the user can still select it.
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={copied ? "Copied" : label}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 ${className}`}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

function Snippet({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-gray-900 p-3 pr-20 text-xs leading-relaxed text-gray-100">
        <code>{code}</code>
      </pre>
      <CopyButton text={code} label="Copy snippet" className="absolute right-2 top-2" />
    </div>
  )
}

export function ApiKeysView({ initialKeys, canUseMcp, mcpUrl }: Props) {
  const [keys, setKeys] = useState<ApiKeyRow[]>(initialKeys)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [revealed, setRevealed] = useState<{ name: string; plaintext: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const activeKeys = keys.filter((k) => !k.revokedAt)
  const revokedKeys = keys.filter((k) => k.revokedAt)

  // Once a key has just been created, the snippets show the real key so they
  // can be pasted as-is; otherwise a placeholder.
  const snippetKey = revealed?.plaintext ?? KEY_PLACEHOLDER
  const claudeCodeSnippet = `claude mcp add --transport http journeyperfect ${mcpUrl} --header "Authorization: Bearer ${snippetKey}"`
  const claudeDesktopSnippet = JSON.stringify(
    {
      mcpServers: {
        journeyperfect: {
          type: "http",
          url: mcpUrl,
          headers: { Authorization: `Bearer ${snippetKey}` },
        },
      },
    },
    null,
    2
  )

  const submitCreate = () => {
    setError(null)
    startTransition(async () => {
      try {
        const { plaintext, ...created } = await createApiKey(newName)
        setKeys((prev) => [
          {
            id: created.id,
            name: created.name,
            prefix: created.prefix,
            lastUsedAt: null,
            revokedAt: null,
            createdAt: new Date(created.createdAt).toISOString(),
          },
          ...prev,
        ])
        setRevealed({ name: created.name, plaintext })
        setNewName("")
        setCreating(false)
      } catch (err) {
        setError(friendlyError(err))
      }
    })
  }

  const revoke = (key: ApiKeyRow) => {
    if (!window.confirm(`Revoke "${key.name}"? Any agent using it will stop working immediately.`)) return
    setError(null)
    startTransition(async () => {
      try {
        await revokeApiKey(key.id)
        setKeys((prev) => prev.map((k) => (k.id === key.id ? { ...k, revokedAt: new Date().toISOString() } : k)))
      } catch (err) {
        setError(friendlyError(err))
      }
    })
  }

  return (
    <div className="space-y-6">
      {!canUseMcp && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            Agent (MCP) access is part of the Personal plan and above.{" "}
            <Link href="/settings/billing" className="font-medium underline">
              Upgrade
            </Link>{" "}
            to create keys. Existing keys stop working while you are on the Free plan.
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      {/* Keys */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-indigo-600" /> Your keys
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              A key acts as you: it can read every trip you can and edit every trip you can edit.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCreating(true)
              setError(null)
            }}
            disabled={!canUseMcp || pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> New key
          </button>
        </div>

        {activeKeys.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
            No active keys yet. Create one, then paste it into your agent.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {activeKeys.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{key.name}</div>
                  <div className="text-xs text-gray-500 font-mono">
                    jp_{key.prefix}&hellip;{" "}
                    <span className="font-sans">
                      &middot; created {formatDate(key.createdAt)} &middot; last used {formatDate(key.lastUsedAt)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(key)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Revoke
                </button>
              </li>
            ))}
          </ul>
        )}

        {revokedKeys.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-gray-500">
              {revokedKeys.length} revoked {revokedKeys.length === 1 ? "key" : "keys"}
            </summary>
            <ul className="mt-2 divide-y divide-gray-100">
              {revokedKeys.map((key) => (
                <li key={key.id} className="py-2 text-xs text-gray-400">
                  <span className="line-through">{key.name}</span> &middot; jp_{key.prefix}&hellip; &middot; revoked{" "}
                  {formatDate(key.revokedAt)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Connect an agent */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Connect an agent</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            JourneyPerfect speaks MCP over HTTP. Point any MCP client at the endpoint and send your key as a bearer
            token.
          </p>
        </div>

        <div>
          <div className="text-xs font-medium text-gray-700 mb-1">MCP endpoint</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800">
              {mcpUrl}
            </code>
            <CopyButton text={mcpUrl} label="Copy endpoint URL" />
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-gray-700 mb-1">Claude Code</div>
          <Snippet code={claudeCodeSnippet} />
        </div>

        <div>
          <div className="text-xs font-medium text-gray-700 mb-1">Claude Desktop (claude_desktop_config.json)</div>
          <Snippet code={claudeDesktopSnippet} />
        </div>

        {!revealed && (
          <p className="text-xs text-gray-500">
            Replace <code className="font-mono">{KEY_PLACEHOLDER}</code> with a key from above. Tools available:
            list_trips, get_trip, create_trip, get_itinerary, add_flight, add_reservation, list_outstanding_tasks,
            add_activity.
          </p>
        )}
      </section>

      {/* Create dialog */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-semibold text-gray-900">New API key</h3>
              <button type="button" onClick={() => setCreating(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="block text-sm text-gray-700 mb-1" htmlFor="api-key-name">
              What will use this key?
            </label>
            <input
              id="api-key-name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) submitCreate()
              }}
              placeholder="e.g. Claude Desktop on my laptop"
              maxLength={60}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitCreate}
                disabled={pending || !newName.trim()}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create key"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reveal-once dialog */}
      {revealed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 className="font-semibold text-gray-900 mb-1">Copy your key now</h3>
            <p className="text-sm text-gray-600 mb-4">
              This is the only time <span className="font-medium">{revealed.name}</span> will be shown. JourneyPerfect
              stores only a hash of it.
            </p>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 break-all rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                {revealed.plaintext}
              </code>
              <CopyButton text={revealed.plaintext} label="Copy key" />
            </div>
            <div className="text-xs font-medium text-gray-700 mb-1">Add it to Claude Code</div>
            <Snippet code={claudeCodeSnippet} />
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setRevealed(null)}
                className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                I have saved it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
