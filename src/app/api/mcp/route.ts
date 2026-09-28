import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { hasFeature } from "@/lib/features"
import { authenticateApiKey } from "@/lib/mcp/auth"
import { createRateLimiter, handleMcpPost, methodNotAllowed, type McpServerDeps } from "@/lib/mcp/server"
import { toolRegistry } from "@/lib/mcp/tools"

export const dynamic = "force-dynamic"

const RATE_LIMIT_PER_MINUTE = 120
const allow = createRateLimiter(RATE_LIMIT_PER_MINUTE, 60_000)

const deps: McpServerDeps = {
  authenticate: authenticateApiKey,
  async isAuthorized({ userId }) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
    return !!user && hasFeature(user.plan, "mcpAccess")
  },
  allowRequest: ({ keyId }) => allow(keyId),
  tools: toolRegistry,
}

export async function POST(request: NextRequest) {
  return handleMcpPost(request, deps)
}

// Streamable HTTP allows a GET to open a server-push stream; this server has
// nothing to push, and it is stateless so there is no session to DELETE.
export async function GET() {
  return methodNotAllowed()
}

export async function DELETE() {
  return methodNotAllowed()
}
