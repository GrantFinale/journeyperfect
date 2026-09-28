/**
 * Minimal typed client for OpenRouter's OpenAI-compatible chat completions
 * endpoint with tool calling. See
 * docs/plans/flights-search-tracking-and-booking.md §5.
 *
 * Pure: no Prisma, no config reads. The API key, model and `fetch` are all
 * injected so the module is unit-testable without OPENROUTER_API_KEY.
 */

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"

/** JSON-schema object describing a tool's arguments. */
export type JsonSchema = Record<string, unknown>

export interface ToolSpec {
  type: "function"
  function: {
    name: string
    description: string
    parameters: JsonSchema
  }
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    /** JSON-encoded arguments, exactly as the model produced them. */
    arguments: string
  }
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string }

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AssistantTurn {
  content: string | null
  toolCalls: ToolCall[]
  /** "stop" | "tool_calls" | "length" | ... as reported by the provider. */
  finishReason: string | null
  usage: ChatUsage
  /** Provider-reported model id, when present. */
  model?: string
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface ChatWithToolsOptions {
  model: string
  messages: ChatMessage[]
  tools?: ToolSpec[]
  apiKey: string
  /** Hard cap on completion tokens for this single call. */
  maxTokens?: number
  temperature?: number
  /** "auto" (default when tools are present) | "none" | "required". */
  toolChoice?: "auto" | "none" | "required"
  /** Abort the request after this many ms (default 60s). */
  timeoutMs?: number
  /** Injected for tests; defaults to global fetch. */
  fetch?: FetchLike
  signal?: AbortSignal
}

export class OpenRouterError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, body: string) {
    super(`OpenRouter API error ${status}: ${body.slice(0, 300)}`)
    this.name = "OpenRouterError"
    this.status = status
    this.body = body
  }
}

/** Raw wire shape (only the fields we read). */
interface RawCompletion {
  model?: string
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: { name?: string; arguments?: string | null }
      }>
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  error?: { message?: string }
}

/**
 * One round trip to the model. Never retries; the caller (tool-loop.ts)
 * owns iteration and token budgets.
 */
export async function chatWithTools(opts: ChatWithToolsOptions): Promise<AssistantTurn> {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000)
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort(), { once: true })

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.2,
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools
    body.tool_choice = opts.toolChoice ?? "auto"
  }

  let res: Response
  try {
    res = await doFetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
        "HTTP-Referer": "https://journeyperfect.com",
        "X-Title": "JourneyPerfect",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new OpenRouterError(res.status, text)
  }

  const data = (await res.json()) as RawCompletion
  if (data.error?.message) throw new OpenRouterError(200, data.error.message)

  return parseCompletion(data)
}

/** Exported for tests. Tolerates missing fields and malformed tool calls. */
export function parseCompletion(data: RawCompletion): AssistantTurn {
  const choice = data.choices?.[0]
  const msg = choice?.message
  const toolCalls: ToolCall[] = []
  for (const tc of msg?.tool_calls ?? []) {
    const name = tc.function?.name
    if (!name) continue
    toolCalls.push({
      id: tc.id ?? `call_${toolCalls.length}`,
      type: "function",
      function: { name, arguments: tc.function?.arguments ?? "{}" },
    })
  }
  const promptTokens = data.usage?.prompt_tokens ?? 0
  const completionTokens = data.usage?.completion_tokens ?? 0
  return {
    content: msg?.content ?? null,
    toolCalls,
    finishReason: choice?.finish_reason ?? null,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens,
    },
    model: data.model,
  }
}
