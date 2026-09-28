import { describe, it, expect, vi } from "vitest"
import {
  createRateLimiter,
  handleJsonRpcMessage,
  handleMcpPost,
  methodNotAllowed,
  MAX_BATCH_LENGTH,
  MAX_BODY_BYTES,
  MCP_PROTOCOL_VERSION,
  type McpServerDeps,
  type McpToolRegistry,
  type McpToolResult,
} from "@/lib/mcp/server"

const GOOD_KEY = "jp_" + "a".repeat(43)
const PRINCIPAL = { userId: "user_1", keyId: "key_1" }

function fakeRegistry(): McpToolRegistry & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    list: () => [
      { name: "echo", description: "Echoes its arguments", inputSchema: { type: "object" } },
      { name: "boom", description: "Throws", inputSchema: { type: "object" } },
    ],
    has: (name) => name === "echo" || name === "boom",
    async call(name, args, ctx): Promise<McpToolResult> {
      calls.push({ name, args, ctx })
      if (name === "boom") throw new Error("secret internals")
      return { content: [{ type: "text", text: JSON.stringify({ echoed: args, userId: ctx.userId }) }] }
    },
  }
}

function makeDeps(overrides: Partial<McpServerDeps> = {}): McpServerDeps & { tools: ReturnType<typeof fakeRegistry> } {
  const tools = fakeRegistry()
  return {
    authenticate: async (header) => (header === `Bearer ${GOOD_KEY}` ? PRINCIPAL : null),
    isAuthorized: async () => true,
    allowRequest: () => true,
    tools,
    ...overrides,
  } as McpServerDeps & { tools: ReturnType<typeof fakeRegistry> }
}

function post(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${GOOD_KEY}` }) {
  return new Request("https://example.test/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

describe("MCP HTTP transport", () => {
  it("answers initialize with the protocol version, capabilities and server info", async () => {
    const res = await handleMcpPost(
      post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
      makeDeps()
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")
    const json = await res.json()
    expect(json.id).toBe(1)
    expect(json.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
    expect(json.result.capabilities.tools).toBeDefined()
    expect(json.result.serverInfo.name).toBe("journeyperfect")
  })

  it("falls back to the latest protocol version when the client asks for one we do not know", async () => {
    const res = await handleMcpPost(
      post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }),
      makeDeps()
    )
    const json = await res.json()
    expect(json.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
  })

  it("acknowledges notifications/initialized with 202 and no body", async () => {
    const res = await handleMcpPost(post({ jsonrpc: "2.0", method: "notifications/initialized" }), makeDeps())
    expect(res.status).toBe(202)
    expect(await res.text()).toBe("")
  })

  it("lists tools", async () => {
    const res = await handleMcpPost(post({ jsonrpc: "2.0", id: "list", method: "tools/list" }), makeDeps())
    const json = await res.json()
    expect(json.id).toBe("list")
    expect(json.result.tools.map((t: { name: string }) => t.name)).toEqual(["echo", "boom"])
  })

  it("calls a tool with the authenticated userId in context", async () => {
    const deps = makeDeps()
    const res = await handleMcpPost(
      post({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "echo", arguments: { hello: "world" } } }),
      deps
    )
    const json = await res.json()
    expect(json.error).toBeUndefined()
    expect(json.result.content[0].type).toBe("text")
    expect(JSON.parse(json.result.content[0].text)).toEqual({ echoed: { hello: "world" }, userId: "user_1" })
    expect(deps.tools.calls).toHaveLength(1)
    expect((deps.tools.calls[0] as { ctx: { userId: string } }).ctx.userId).toBe("user_1")
  })

  it("rejects unknown tools with -32602", async () => {
    const res = await handleMcpPost(
      post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nope", arguments: {} } }),
      makeDeps()
    )
    const json = await res.json()
    expect(json.error.code).toBe(-32602)
  })

  it("hides tool exceptions behind a generic -32603", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await handleMcpPost(
      post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "boom", arguments: {} } }),
      makeDeps()
    )
    const json = await res.json()
    expect(json.error.code).toBe(-32603)
    expect(json.error.message).toBe("Internal error")
    expect(JSON.stringify(json)).not.toContain("secret internals")
    spy.mockRestore()
  })

  it("returns 401 without a valid key and never touches the tools", async () => {
    const deps = makeDeps()
    const missing = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }, {}), deps)
    expect(missing.status).toBe(401)
    expect(missing.headers.get("www-authenticate")).toContain("Bearer")

    const wrong = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "Bearer jp_wrong" }), deps)
    expect(wrong.status).toBe(401)
    expect(deps.tools.calls).toHaveLength(0)
  })

  it("returns 403 when the plan lacks mcpAccess", async () => {
    const res = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }), makeDeps({ isAuthorized: async () => false }))
    expect(res.status).toBe(403)
  })

  it("returns 429 when the rate limiter says no", async () => {
    const res = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }), makeDeps({ allowRequest: () => false }))
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("60")
  })

  it("returns -32601 for unknown methods", async () => {
    const res = await handleMcpPost(post({ jsonrpc: "2.0", id: 9, method: "resources/list" }), makeDeps())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.id).toBe(9)
    expect(json.error.code).toBe(-32601)
  })

  it("returns -32700 for malformed JSON", async () => {
    const res = await handleMcpPost(post("{ not json"), makeDeps())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.id).toBeNull()
    expect(json.error.code).toBe(-32700)
  })

  it("returns -32600 for a well-formed body that is not a JSON-RPC request", async () => {
    const res = await handleMcpPost(post({ hello: "world" }), makeDeps())
    const json = await res.json()
    expect(json.error.code).toBe(-32600)
  })

  it("handles batches, dropping notification responses", async () => {
    const res = await handleMcpPost(
      post([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]),
      makeDeps()
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json)).toBe(true)
    expect(json).toHaveLength(2)
    expect(json.map((r: { id: number }) => r.id)).toEqual([1, 2])
  })

  it("rejects an empty batch", async () => {
    const res = await handleMcpPost(post([]), makeDeps())
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe(-32600)
  })

  it("rejects a batch longer than MAX_BATCH_LENGTH with -32600 and calls no tools", async () => {
    const deps = makeDeps()
    const batch = Array.from({ length: MAX_BATCH_LENGTH + 1 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "tools/list" }))
    const res = await handleMcpPost(post(batch), deps)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe(-32600)
    expect(deps.tools.calls).toHaveLength(0)
  })

  it("charges the rate limiter once per message in a batch", async () => {
    const allowRequest = vi.fn(() => true)
    const res = await handleMcpPost(
      post([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ]),
      makeDeps({ allowRequest })
    )
    expect(res.status).toBe(200)
    expect(allowRequest).toHaveBeenCalledTimes(3)
  })

  it("returns 429 when the limiter runs out midway through a batch", async () => {
    let budget = 2
    const deps = makeDeps({ allowRequest: () => budget-- > 0 })
    const res = await handleMcpPost(
      post([
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo" } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo" } },
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo" } },
      ]),
      deps
    )
    expect(res.status).toBe(429)
    expect(deps.tools.calls).toHaveLength(0)
  })

  it("rejects bodies over MAX_BODY_BYTES with 413", async () => {
    const big = { jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(MAX_BODY_BYTES) } }
    const res = await handleMcpPost(post(big), makeDeps())
    expect(res.status).toBe(413)
  })

  it("answers ping", async () => {
    const out = await handleJsonRpcMessage({ jsonrpc: "2.0", id: 5, method: "ping" }, { userId: "u" }, fakeRegistry())
    expect(out).toEqual({ jsonrpc: "2.0", id: 5, result: {} })
  })

  it("GET is 405 with Allow: POST", async () => {
    const res = methodNotAllowed()
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })
})

describe("rate limiter", () => {
  it("allows `limit` requests per window and then refuses until the window rolls", () => {
    const allow = createRateLimiter(3, 1000)
    const t0 = 1_000_000
    expect(allow("k", t0)).toBe(true)
    expect(allow("k", t0 + 1)).toBe(true)
    expect(allow("k", t0 + 2)).toBe(true)
    expect(allow("k", t0 + 3)).toBe(false)
    expect(allow("other", t0 + 3)).toBe(true)
    expect(allow("k", t0 + 1000)).toBe(true)
  })
})
