import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { hasFeature } from "@/lib/features"
import { listApiKeys } from "@/lib/actions/api-keys"
import { ApiKeysView } from "./api-keys-view"

function appUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "https://www.journeyperfect.com"
  return base.replace(/\/+$/, "")
}

export default async function ApiKeysPage() {
  const session = await auth()
  const userId = session?.user?.id
  const [user, keys] = await Promise.all([
    userId ? prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }) : null,
    listApiKeys(),
  ])
  const canUseMcp = !!user && hasFeature(user.plan, "mcpAccess")

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">API Keys</h1>
      <p className="text-sm text-gray-500 mb-6">
        Let Claude, ChatGPT or any MCP-capable agent read and write your trips.
      </p>
      <ApiKeysView
        initialKeys={keys.map((k) => ({
          ...k,
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          revokedAt: k.revokedAt?.toISOString() ?? null,
          createdAt: k.createdAt.toISOString(),
        }))}
        canUseMcp={canUseMcp}
        mcpUrl={`${appUrl()}/api/mcp`}
      />
    </div>
  )
}
