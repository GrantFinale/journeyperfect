/**
 * Generic bounded tool-calling agent loop. See
 * docs/plans/flights-search-tracking-and-booking.md §5 ("Hard guards").
 *
 * The loop is pure and model-agnostic: it takes a `callModel` function so
 * tests can drive it with a scripted fake, and production wires it to
 * OpenRouter through `makeOpenRouterCaller`. It stops on the first of:
 *   - the assistant replying with no tool calls (final text),
 *   - the iteration cap,
 *   - the cumulative token budget,
 *   - a model/transport error (surfaced as stopReason "error").
 *
 * Every tool result is JSON-stringified and truncated to `maxToolResultChars`
 * before it re-enters the context, so a chatty tool cannot blow the budget.
 */
import {
  chatWithTools,
  type AssistantTurn,
  type ChatMessage,
  type ChatUsage,
  type FetchLike,
  type JsonSchema,
  type ToolCall,
  type ToolSpec,
} from "./openrouter"

export interface ToolDef {
  name: string
  description: string
  /** JSON schema for the arguments object. */
  parameters: JsonSchema
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

export interface ModelRequest {
  messages: ChatMessage[]
  tools: ToolSpec[]
  /** Per-call completion cap. */
  maxTokens: number
  toolChoice: "auto" | "none"
}

export type ModelCaller = (req: ModelRequest) => Promise<AssistantTurn>

export type StopReason = "final" | "max_iterations" | "token_budget" | "error"

export interface RunToolLoopOptions {
  system: string
  user: string
  tools: ToolDef[]
  /** Max model calls (each call may request several tools). */
  maxIterations: number
  /** Cumulative prompt+completion token budget for the whole run. */
  maxTokens: number
  callModel: ModelCaller
  /** Called after every model turn with that turn's usage. */
  onUsage?: (usage: ChatUsage, iteration: number) => void
  /** Per-call completion cap passed to the model (default 2048). */
  maxCompletionTokens?: number
  /** Tool results longer than this are truncated (default 6000 chars). */
  maxToolResultChars?: number
  /**
   * When the iteration cap or token budget is hit before the model has
   * answered, spend one more call with tools disabled asking it to answer
   * from what it has. Default false.
   */
  finalizeOnCap?: boolean
  /** Message used for the finalize call. */
  finalizeMessage?: string
}

export interface ToolLoopResult {
  /** Assistant's last text reply, or null if it never produced one. */
  finalText: string | null
  transcript: ChatMessage[]
  /** Number of model calls made (including a finalize call, if any). */
  iterations: number
  tokens: ChatUsage
  stopReason: StopReason
  error?: string
  toolCallCount: number
}

const DEFAULT_MAX_TOOL_RESULT_CHARS = 6000
const DEFAULT_FINALIZE_MESSAGE =
  "You have used your tool budget. Stop calling tools and produce your final answer now from the information already gathered."

export function toToolSpec(t: ToolDef): ToolSpec {
  return {
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }
}

/** JSON-stringify a tool result and truncate it. Exported for tests. */
export function serialiseToolResult(value: unknown, maxChars: number): string {
  let text: string
  try {
    text = typeof value === "string" ? value : JSON.stringify(value ?? null)
  } catch {
    text = String(value)
  }
  if (text === undefined) text = "null"
  if (text.length <= maxChars) return text
  const omitted = text.length - maxChars
  return `${text.slice(0, maxChars)}…[truncated ${omitted} chars]`
}

function parseArgs(raw: string): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || raw.trim() === "") return { ok: true, args: {} }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, args: parsed as Record<string, unknown> }
    }
    return { ok: false, error: "Arguments must be a JSON object" }
  } catch (e) {
    return { ok: false, error: `Invalid JSON arguments: ${(e as Error).message}` }
  }
}

function addUsage(a: ChatUsage, b: ChatUsage): ChatUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

async function executeToolCall(
  call: ToolCall,
  tools: Map<string, ToolDef>,
  maxChars: number
): Promise<ChatMessage> {
  const tool = tools.get(call.function.name)
  let result: unknown
  if (!tool) {
    result = { error: `Unknown tool "${call.function.name}"` }
  } else {
    const parsed = parseArgs(call.function.arguments)
    if (!parsed.ok) {
      result = { error: parsed.error }
    } else {
      try {
        result = await tool.handler(parsed.args)
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) }
      }
    }
  }
  return { role: "tool", tool_call_id: call.id, content: serialiseToolResult(result, maxChars) }
}

export async function runToolLoop(opts: RunToolLoopOptions): Promise<ToolLoopResult> {
  const maxChars = opts.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS
  const maxCompletion = opts.maxCompletionTokens ?? 2048
  const toolMap = new Map(opts.tools.map((t) => [t.name, t]))
  const specs = opts.tools.map(toToolSpec)

  const transcript: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ]
  let tokens: ChatUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  let iterations = 0
  let toolCallCount = 0

  const callOnce = async (toolChoice: "auto" | "none"): Promise<AssistantTurn> => {
    iterations += 1
    const turn = await opts.callModel({
      messages: transcript,
      tools: toolChoice === "none" ? [] : specs,
      maxTokens: maxCompletion,
      toolChoice,
    })
    tokens = addUsage(tokens, turn.usage)
    opts.onUsage?.(turn.usage, iterations)
    transcript.push({
      role: "assistant",
      content: turn.content,
      ...(turn.toolCalls.length > 0 ? { tool_calls: turn.toolCalls } : {}),
    })
    return turn
  }

  const finalize = async (reason: StopReason): Promise<ToolLoopResult> => {
    if (!opts.finalizeOnCap) {
      return { finalText: null, transcript, iterations, tokens, stopReason: reason, toolCallCount }
    }
    transcript.push({ role: "user", content: opts.finalizeMessage ?? DEFAULT_FINALIZE_MESSAGE })
    try {
      const turn = await callOnce("none")
      return {
        finalText: turn.content,
        transcript,
        iterations,
        tokens,
        stopReason: reason,
        toolCallCount,
      }
    } catch (e) {
      return {
        finalText: null,
        transcript,
        iterations,
        tokens,
        stopReason: "error",
        error: e instanceof Error ? e.message : String(e),
        toolCallCount,
      }
    }
  }

  try {
    while (iterations < opts.maxIterations) {
      const turn = await callOnce("auto")

      if (turn.toolCalls.length === 0) {
        return { finalText: turn.content, transcript, iterations, tokens, stopReason: "final", toolCallCount }
      }

      toolCallCount += turn.toolCalls.length
      // Sequential on purpose: tool handlers hit rate-limited providers and
      // per-user daily caps, and a burst of concurrent calls can slip past
      // those caps before any of them is recorded.
      for (const call of turn.toolCalls) {
        transcript.push(await executeToolCall(call, toolMap, maxChars))
      }

      if (tokens.totalTokens >= opts.maxTokens) {
        return finalize("token_budget")
      }
    }
    return finalize("max_iterations")
  } catch (e) {
    return {
      finalText: null,
      transcript,
      iterations,
      tokens,
      stopReason: "error",
      error: e instanceof Error ? e.message : String(e),
      toolCallCount,
    }
  }
}

/** Production ModelCaller backed by OpenRouter. */
export function makeOpenRouterCaller(cfg: {
  model: string
  apiKey: string
  temperature?: number
  fetch?: FetchLike
  timeoutMs?: number
}): ModelCaller {
  return (req) =>
    chatWithTools({
      model: cfg.model,
      apiKey: cfg.apiKey,
      messages: req.messages,
      tools: req.tools,
      maxTokens: req.maxTokens,
      temperature: cfg.temperature,
      toolChoice: req.tools.length > 0 ? req.toolChoice : undefined,
      fetch: cfg.fetch,
      timeoutMs: cfg.timeoutMs,
    })
}
