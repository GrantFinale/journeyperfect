import { describe, it, expect, vi } from "vitest"
import { runToolLoop, serialiseToolResult, type ModelCaller, type ToolDef } from "@/lib/ai/tool-loop"
import { chatWithTools, parseCompletion, OpenRouterError, type AssistantTurn, type ChatMessage } from "@/lib/ai/openrouter"

const usage = (p = 100, c = 50) => ({ promptTokens: p, completionTokens: c, totalTokens: p + c })

function text(content: string, u = usage()): AssistantTurn {
  return { content, toolCalls: [], finishReason: "stop", usage: u }
}

function calls(list: Array<{ name: string; args: unknown; id?: string }>, u = usage()): AssistantTurn {
  return {
    content: null,
    finishReason: "tool_calls",
    usage: u,
    toolCalls: list.map((c, i) => ({
      id: c.id ?? `call_${i}`,
      type: "function" as const,
      function: { name: c.name, arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args) },
    })),
  }
}

/** Scripted model: returns turns in order; records every request. */
function scripted(turns: AssistantTurn[]) {
  const requests: Array<{ messages: ChatMessage[]; toolChoice: string; toolCount: number }> = []
  let i = 0
  const callModel: ModelCaller = async (req) => {
    requests.push({ messages: [...req.messages], toolChoice: req.toolChoice, toolCount: req.tools.length })
    const t = turns[Math.min(i, turns.length - 1)]
    i += 1
    return t
  }
  return { callModel, requests }
}

const addTool: ToolDef = {
  name: "add",
  description: "adds",
  parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
  handler: async (args) => ({ sum: Number(args.a) + Number(args.b) }),
}

const boomTool: ToolDef = {
  name: "boom",
  description: "throws",
  parameters: { type: "object", properties: {} },
  handler: async () => {
    throw new Error("kaboom")
  },
}

describe("runToolLoop", () => {
  it("returns final text immediately when the model does not call tools", async () => {
    const { callModel, requests } = scripted([text("done")])
    const res = await runToolLoop({ system: "s", user: "u", tools: [addTool], maxIterations: 5, maxTokens: 10_000, callModel })
    expect(res.stopReason).toBe("final")
    expect(res.finalText).toBe("done")
    expect(res.iterations).toBe(1)
    expect(res.toolCallCount).toBe(0)
    expect(res.tokens).toEqual(usage())
    expect(requests[0].messages).toEqual([
      { role: "system", content: "s" },
      { role: "user", content: "u" },
    ])
    expect(requests[0].toolCount).toBe(1)
  })

  it("executes tool calls, feeds results back, and stops on the final answer", async () => {
    const { callModel, requests } = scripted([calls([{ name: "add", args: { a: 2, b: 3 }, id: "c1" }]), text("5")])
    const onUsage = vi.fn()
    const res = await runToolLoop({
      system: "s",
      user: "u",
      tools: [addTool],
      maxIterations: 5,
      maxTokens: 10_000,
      callModel,
      onUsage,
    })
    expect(res.stopReason).toBe("final")
    expect(res.finalText).toBe("5")
    expect(res.iterations).toBe(2)
    expect(res.toolCallCount).toBe(1)
    expect(res.tokens.totalTokens).toBe(300)
    expect(onUsage).toHaveBeenCalledTimes(2)

    // Second request carries the assistant tool_calls turn and the tool result
    const second = requests[1].messages
    expect(second[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1" }] })
    expect(second[3]).toEqual({ role: "tool", tool_call_id: "c1", content: JSON.stringify({ sum: 5 }) })
    expect(res.transcript).toHaveLength(5)
  })

  it("runs a turn's tool calls one at a time, in order, and reports unknown tools, bad JSON and handler errors as results", async () => {
    const { callModel } = scripted([
      calls([
        { name: "add", args: { a: 1, b: 1 }, id: "ok" },
        { name: "nope", args: {}, id: "unknown" },
        { name: "add", args: "{not json", id: "bad" },
        { name: "boom", args: {}, id: "throws" },
      ]),
      text("fin"),
    ])
    // Track overlap: a sequential loop never has two handlers in flight at once.
    let inFlight = 0
    let maxInFlight = 0
    const started: string[] = []
    const slowAdd: ToolDef = {
      ...addTool,
      handler: async (args) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        started.push(`add:${JSON.stringify(args)}`)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return addTool.handler(args)
      },
    }
    const slowBoom: ToolDef = {
      ...boomTool,
      handler: async (args) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        started.push("boom")
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return boomTool.handler(args)
      },
    }
    const res = await runToolLoop({
      system: "s",
      user: "u",
      tools: [slowAdd, slowBoom],
      maxIterations: 5,
      maxTokens: 10_000,
      callModel,
    })
    expect(maxInFlight).toBe(1)
    expect(started).toEqual(['add:{"a":1,"b":1}', "boom"])
    const toolMsgs = res.transcript.filter((m) => m.role === "tool") as Extract<ChatMessage, { role: "tool" }>[]
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["ok", "unknown", "bad", "throws"])
    expect(JSON.parse(toolMsgs[0].content)).toEqual({ sum: 2 })
    expect(JSON.parse(toolMsgs[1].content).error).toMatch(/Unknown tool/)
    expect(JSON.parse(toolMsgs[2].content).error).toMatch(/Invalid JSON/)
    expect(JSON.parse(toolMsgs[3].content).error).toBe("kaboom")
    expect(res.toolCallCount).toBe(4)
    expect(res.stopReason).toBe("final")
  })

  it("truncates oversized tool results", async () => {
    const bigTool: ToolDef = {
      name: "big",
      description: "",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ blob: "x".repeat(5000) }),
    }
    const { callModel } = scripted([calls([{ name: "big", args: {} }]), text("ok")])
    const res = await runToolLoop({
      system: "s",
      user: "u",
      tools: [bigTool],
      maxIterations: 3,
      maxTokens: 10_000,
      callModel,
      maxToolResultChars: 200,
    })
    const toolMsg = res.transcript.find((m) => m.role === "tool") as Extract<ChatMessage, { role: "tool" }>
    expect(toolMsg.content.length).toBeLessThan(260)
    expect(toolMsg.content).toMatch(/\[truncated \d+ chars\]$/)
  })

  it("stops at the iteration cap without a final answer", async () => {
    const { callModel } = scripted([calls([{ name: "add", args: { a: 1, b: 1 } }])])
    const res = await runToolLoop({ system: "s", user: "u", tools: [addTool], maxIterations: 3, maxTokens: 1e9, callModel })
    expect(res.stopReason).toBe("max_iterations")
    expect(res.finalText).toBeNull()
    expect(res.iterations).toBe(3)
    expect(res.toolCallCount).toBe(3)
  })

  it("stops when the token budget is exhausted", async () => {
    const { callModel } = scripted([calls([{ name: "add", args: { a: 1, b: 1 } }], usage(600, 100))])
    const res = await runToolLoop({ system: "s", user: "u", tools: [addTool], maxIterations: 50, maxTokens: 1000, callModel })
    expect(res.stopReason).toBe("token_budget")
    expect(res.iterations).toBe(2) // 700 after 1st, 1400 >= 1000 after 2nd
    expect(res.finalText).toBeNull()
  })

  it("finalizeOnCap spends exactly one more tools-disabled call and returns its text", async () => {
    const { callModel, requests } = scripted([
      calls([{ name: "add", args: { a: 1, b: 1 } }]),
      calls([{ name: "add", args: { a: 1, b: 1 } }]),
      text("forced answer"),
    ])
    const res = await runToolLoop({
      system: "s",
      user: "u",
      tools: [addTool],
      maxIterations: 2,
      maxTokens: 1e9,
      callModel,
      finalizeOnCap: true,
      finalizeMessage: "answer now",
    })
    expect(res.stopReason).toBe("max_iterations")
    expect(res.finalText).toBe("forced answer")
    expect(res.iterations).toBe(3)
    const last = requests[2]
    expect(last.toolChoice).toBe("none")
    expect(last.toolCount).toBe(0)
    expect(last.messages[last.messages.length - 1]).toEqual({ role: "user", content: "answer now" })
  })

  it("surfaces model errors as stopReason error", async () => {
    const callModel: ModelCaller = async () => {
      throw new Error("502 from provider")
    }
    const res = await runToolLoop({ system: "s", user: "u", tools: [], maxIterations: 3, maxTokens: 1000, callModel })
    expect(res.stopReason).toBe("error")
    expect(res.error).toBe("502 from provider")
    expect(res.finalText).toBeNull()
  })
})

describe("serialiseToolResult", () => {
  it("stringifies objects and passes strings through", () => {
    expect(serialiseToolResult({ a: 1 }, 100)).toBe('{"a":1}')
    expect(serialiseToolResult("plain", 100)).toBe("plain")
    expect(serialiseToolResult(undefined, 100)).toBe("null")
  })
  it("truncates with a marker", () => {
    const out = serialiseToolResult("abcdefghij", 4)
    expect(out).toBe("abcd…[truncated 6 chars]")
  })
})

describe("openrouter client", () => {
  it("parseCompletion tolerates missing fields", () => {
    const t = parseCompletion({})
    expect(t).toEqual({ content: null, toolCalls: [], finishReason: null, usage: usage(0, 0), model: undefined })
  })

  it("chatWithTools posts the OpenAI-compatible body and parses tool calls", async () => {
    const seen: { url?: string; init?: RequestInit } = {}
    const fakeFetch = async (url: string, init: RequestInit) => {
      seen.url = url
      seen.init = init
      return new Response(
        JSON.stringify({
          model: "test/model",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{ id: "c1", type: "function", function: { name: "add", arguments: '{"a":1}' } }],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }
    const turn = await chatWithTools({
      model: "test/model",
      apiKey: "sk-test",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "add", description: "", parameters: { type: "object" } } }],
      fetch: fakeFetch,
    })
    expect(seen.url).toBe("https://openrouter.ai/api/v1/chat/completions")
    const headers = seen.init!.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer sk-test")
    const body = JSON.parse(seen.init!.body as string)
    expect(body.model).toBe("test/model")
    expect(body.tools).toHaveLength(1)
    expect(body.tool_choice).toBe("auto")
    expect(turn.toolCalls).toEqual([{ id: "c1", type: "function", function: { name: "add", arguments: '{"a":1}' } }])
    expect(turn.usage).toEqual(usage(10, 5))
    expect(turn.finishReason).toBe("tool_calls")
  })

  it("chatWithTools throws OpenRouterError on non-2xx", async () => {
    const fakeFetch = async () => new Response("rate limited", { status: 429 })
    await expect(
      chatWithTools({ model: "m", apiKey: "k", messages: [{ role: "user", content: "x" }], fetch: fakeFetch })
    ).rejects.toBeInstanceOf(OpenRouterError)
  })
})
