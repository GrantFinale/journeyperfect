/**
 * Hand-rolled MCP Streamable HTTP transport: JSON-RPC 2.0 over POST, replies
 * as `application/json` (no SSE stream — every tool call completes in one
 * round trip). Stateless: there are no sessions, so `initialize` can be
 * repeated freely and `notifications/initialized` is simply acknowledged.
 *
 * Kept free of Next.js and Prisma imports so it can be unit-tested with a fake
 * authenticator and a fake tool registry (see src/__tests__/mcp-server.test.ts).
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18"
/** Older revisions we can honour verbatim: the subset we implement is identical. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const

export const SERVER_INFO = { name: "journeyperfect", version: "1.0.0" }

/** Largest JSON-RPC batch accepted in one POST; longer batches are -32600. */
export const MAX_BATCH_LENGTH = 20
/** Largest request body accepted; larger bodies are 413. */
export const MAX_BODY_BYTES = 256 * 1024

export const SERVER_INSTRUCTIONS =
  "JourneyPerfect is the traveller's trip system of record. Use list_trips / get_trip to find the " +
  "trip the user means, then write into it with add_flight, add_reservation and add_activity. " +
  "list_outstanding_tasks shows what still needs booking, paying or checking in. " +
  "All ids are opaque strings returned by earlier calls; dates are ISO 8601."

// ─── JSON-RPC types ──────────────────────────────────────────────────────────

export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id?: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: JsonRpcId
  result?: unknown
  error?: JsonRpcError
}

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

// ─── Tool registry contract ─────────────────────────────────────────────────

export interface McpToolContent {
  type: "text"
  text: string
}

export interface McpToolResult {
  content: McpToolContent[]
  isError?: boolean
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpCallContext {
  userId: string
}

export interface McpToolRegistry {
  list(): McpToolDefinition[]
  has(name: string): boolean
  call(name: string, args: unknown, ctx: McpCallContext): Promise<McpToolResult>
}

// ─── Message handling ────────────────────────────────────────────────────────

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result }
}

function fail(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isValidId(id: unknown): id is JsonRpcId {
  return id === null || typeof id === "string" || (typeof id === "number" && Number.isFinite(id))
}

/**
 * Handles one JSON-RPC message. Returns null for notifications (no `id`),
 * which the transport must not answer.
 */
export async function handleJsonRpcMessage(
  message: unknown,
  ctx: McpCallContext,
  tools: McpToolRegistry
): Promise<JsonRpcResponse | null> {
  if (!isObject(message)) {
    return fail(null, JSON_RPC_ERRORS.INVALID_REQUEST, "Invalid Request: expected a JSON object")
  }

  const hasId = "id" in message && message.id !== undefined
  const id: JsonRpcId = hasId && isValidId(message.id) ? message.id : null

  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return fail(id, JSON_RPC_ERRORS.INVALID_REQUEST, "Invalid Request: jsonrpc must be \"2.0\" and method a string")
  }
  if (hasId && !isValidId(message.id)) {
    return fail(null, JSON_RPC_ERRORS.INVALID_REQUEST, "Invalid Request: id must be a string, number or null")
  }

  const method = message.method
  const params = message.params
  const isNotification = !hasId

  // Notifications: acknowledged silently, including ones we don't know.
  if (method.startsWith("notifications/")) return null
  if (isNotification) return null

  switch (method) {
    case "initialize": {
      const requested = isObject(params) ? params.protocolVersion : undefined
      const protocolVersion =
        typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : MCP_PROTOCOL_VERSION
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      })
    }

    case "ping":
      return ok(id, {})

    case "tools/list":
      return ok(id, { tools: tools.list() })

    case "tools/call": {
      if (!isObject(params) || typeof params.name !== "string") {
        return fail(id, JSON_RPC_ERRORS.INVALID_PARAMS, "Invalid params: expected { name: string, arguments?: object }")
      }
      if (!tools.has(params.name)) {
        return fail(id, JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${params.name}`)
      }
      const args = params.arguments === undefined ? {} : params.arguments
      if (!isObject(args)) {
        return fail(id, JSON_RPC_ERRORS.INVALID_PARAMS, "Invalid params: arguments must be an object")
      }
      try {
        const result = await tools.call(params.name, args, ctx)
        return ok(id, result)
      } catch (err) {
        // Tool handlers are expected to convert their own failures into
        // `isError` results; anything escaping here is a bug, and the client
        // gets a generic message rather than internals.
        console.error(`[mcp] tool ${params.name} threw:`, err)
        return fail(id, JSON_RPC_ERRORS.INTERNAL_ERROR, "Internal error")
      }
    }

    default:
      return fail(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`)
  }
}

// ─── HTTP transport ──────────────────────────────────────────────────────────

export interface McpPrincipal {
  userId: string
  /** Stable identifier for rate limiting — the API key id. */
  keyId: string
}

export interface McpServerDeps {
  /** Resolves the Authorization header; null means 401. */
  authenticate(header: string | null): Promise<McpPrincipal | null>
  /** Plan gate; false means 403. */
  isAuthorized(principal: McpPrincipal): Promise<boolean>
  /**
   * Returns false when the caller has exceeded its budget (429). Charged once
   * per JSON-RPC message, so a batch of N costs N.
   */
  allowRequest(principal: McpPrincipal): boolean
  tools: McpToolRegistry
}

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" }

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })
}

function httpError(status: number, message: string, extra: Record<string, string> = {}): Response {
  return jsonResponse({ error: message }, status, extra)
}

export function methodNotAllowed(): Response {
  return httpError(405, "Method Not Allowed: the JourneyPerfect MCP endpoint accepts POST only", { Allow: "POST" })
}

/** POST handler for the Streamable HTTP transport. */
export async function handleMcpPost(request: Request, deps: McpServerDeps): Promise<Response> {
  const principal = await deps.authenticate(request.headers.get("authorization"))
  if (!principal) {
    return httpError(401, "Unauthorized: supply `Authorization: Bearer jp_...` with a JourneyPerfect API key", {
      "WWW-Authenticate": 'Bearer realm="journeyperfect-mcp"',
    })
  }
  if (!(await deps.isAuthorized(principal))) {
    return httpError(403, "Forbidden: Agent (MCP) Access requires the Personal plan or above")
  }

  // Body size: trust Content-Length when present, and re-check the bytes read
  // since the header can be absent or wrong.
  const declared = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return payloadTooLarge()
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return jsonResponse(fail(null, JSON_RPC_ERRORS.PARSE_ERROR, "Parse error: could not read body"), 400)
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return payloadTooLarge()

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return jsonResponse(fail(null, JSON_RPC_ERRORS.PARSE_ERROR, "Parse error: body is not valid JSON"), 400)
  }

  const ctx: McpCallContext = { userId: principal.userId }

  if (Array.isArray(body)) {
    if (body.length === 0) {
      return jsonResponse(fail(null, JSON_RPC_ERRORS.INVALID_REQUEST, "Invalid Request: empty batch"), 400)
    }
    if (body.length > MAX_BATCH_LENGTH) {
      return jsonResponse(
        fail(null, JSON_RPC_ERRORS.INVALID_REQUEST, `Invalid Request: batch exceeds ${MAX_BATCH_LENGTH} messages`),
        400
      )
    }
    if (!chargeRateLimit(deps, principal, body.length)) return tooManyRequests()
    const responses = (await Promise.all(body.map((m) => handleJsonRpcMessage(m, ctx, deps.tools)))).filter(
      (r): r is JsonRpcResponse => r !== null
    )
    if (responses.length === 0) return new Response(null, { status: 202 })
    return jsonResponse(responses)
  }

  if (!chargeRateLimit(deps, principal, 1)) return tooManyRequests()
  const response = await handleJsonRpcMessage(body, ctx, deps.tools)
  if (response === null) return new Response(null, { status: 202 })
  return jsonResponse(response)
}

/** One limiter charge per message; the whole request is refused if any charge fails. */
function chargeRateLimit(deps: McpServerDeps, principal: McpPrincipal, messages: number): boolean {
  for (let i = 0; i < messages; i++) {
    if (!deps.allowRequest(principal)) return false
  }
  return true
}

function tooManyRequests(): Response {
  return httpError(429, "Too Many Requests: limit is 120 messages per minute per API key", { "Retry-After": "60" })
}

function payloadTooLarge(): Response {
  return httpError(413, `Payload Too Large: request bodies are limited to ${MAX_BODY_BYTES} bytes`)
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

/**
 * Fixed-window in-memory limiter, per process. Good enough for a single Node
 * instance; a multi-instance deployment would need a shared store.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, { start: number; count: number }>()
  let lastSweep = 0

  return function allow(key: string, now = Date.now()): boolean {
    // Occasionally drop expired windows so the map cannot grow without bound.
    if (now - lastSweep > windowMs) {
      for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k)
      lastSweep = now
    }
    const current = windows.get(key)
    if (!current || now - current.start >= windowMs) {
      windows.set(key, { start: now, count: 1 })
      return true
    }
    if (current.count >= limit) return false
    current.count += 1
    return true
  }
}
