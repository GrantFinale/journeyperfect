/**
 * Live view for AWAITING_LOGIN sessions: CDP screencast → WebSocket frames,
 * JSON input messages → page.mouse / page.keyboard.
 *
 *   WS  /live/:sessionId?token=<one-time token from liveViewUrl>
 *
 * Server → client
 *   text   {"type":"meta","viewport":{"width","height"}}
 *   text   {"type":"frame-meta","deviceWidth","deviceHeight","pageScaleFactor"}   (when it changes)
 *   binary JPEG frame
 *   text   {"type":"ended","status"}                                            then close
 *
 * Client → server (coordinates in viewport CSS pixels)
 *   {"type":"mouse","action":"move"|"down"|"up"|"click","x","y","button"?:"left"|"right"|"middle","clickCount"?}
 *   {"type":"key","action":"down"|"up"|"press","key"}   |   {"type":"key","action":"type","text"}
 *   {"type":"wheel","x"?,"y"?,"deltaX","deltaY"}
 *
 * Hard rules: frames are never persisted; key/text payloads are never logged;
 * the token is single-use and only valid while the session is AWAITING_LOGIN;
 * one viewer per session; the socket is closed when the session ends.
 */
import type { IncomingMessage, Server } from "node:http"
import type { Duplex } from "node:stream"
import type { CDPSession, Page } from "playwright"
import { WebSocketServer, type WebSocket } from "ws"
import type { InteractiveSession, Logger, SessionManager } from "./sessions.js"

export const VIEWPORT = { width: 1280, height: 800 } as const
const LIVE_PATH = /^\/live\/([A-Za-z0-9-]{8,64})$/
const MAX_INPUT_BYTES = 4096

interface ScreencastFrame {
  data: string
  metadata: { deviceWidth: number; deviceHeight: number; pageScaleFactor: number; offsetTop: number }
  sessionId: number
}

export interface LiveViewOptions {
  /**
   * Browser origins allowed to open the socket (`scheme://host[:port]`). Empty
   * or omitted accepts any Origin; the token is then the only guard.
   */
  allowedOrigins?: readonly string[]
}

export function attachLiveView(server: Server, sessions: SessionManager, log: Logger, options: LiveViewOptions = {}): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_INPUT_BYTES })
  const allowedOrigins = new Set(options.allowedOrigins ?? [])

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    const m = LIVE_PATH.exec(url.pathname)
    if (!m) return reject(socket, 404)
    // Browsers always send Origin on WebSocket upgrades; when an allow-list is
    // configured, a missing or foreign Origin is refused before the token is
    // even looked at (so a hostile page cannot burn the one-time token).
    if (allowedOrigins.size > 0) {
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : ""
      if (!allowedOrigins.has(origin)) {
        log.warn({ origin: origin || null }, "live view refused: origin not allowed")
        return reject(socket, 403)
      }
    }
    const session = sessions.get(m[1])
    const token = url.searchParams.get("token") ?? ""
    if (!session || !token || !sessions.consumeLiveToken(session, token)) return reject(socket, 401)
    if (session.viewerAttached || !session.page) return reject(socket, 409)
    session.viewerAttached = true

    wss.handleUpgrade(req, socket, head, (ws) => {
      void serve(ws, session, log).catch((err) => {
        log.warn({ sessionId: session.sessionId, err: describe(err) }, "live view ended with error")
        try {
          ws.close(1011, "live view error")
        } catch {
          // already closed
        }
      })
    })
  })

  return wss
}

function reject(socket: Duplex, status: 401 | 403 | 404 | 409): void {
  const reason = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 404 ? "Not Found" : "Conflict"
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

async function serve(ws: WebSocket, session: InteractiveSession, log: Logger): Promise<void> {
  const page = session.page
  if (!page || !session.context) {
    ws.close(1011, "no page")
    session.viewerAttached = false
    return
  }
  const cdp: CDPSession = await session.context.newCDPSession(page)
  let lastMeta = ""
  let closed = false

  const stop = async () => {
    if (closed) return
    closed = true
    session.viewerAttached = false
    try {
      await cdp.send("Page.stopScreencast")
    } catch {
      // page may be gone
    }
    try {
      await cdp.detach()
    } catch {
      // ignore
    }
  }

  cdp.on("Page.screencastFrame", (frame: ScreencastFrame) => {
    if (closed) return
    const meta = JSON.stringify({
      type: "frame-meta",
      deviceWidth: frame.metadata.deviceWidth,
      deviceHeight: frame.metadata.deviceHeight,
      pageScaleFactor: frame.metadata.pageScaleFactor,
    })
    if (meta !== lastMeta) {
      lastMeta = meta
      ws.send(meta)
    }
    // Forward, never store.
    ws.send(Buffer.from(frame.data, "base64"), { binary: true })
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined)
  })

  const onEnd = () => {
    try {
      ws.send(JSON.stringify({ type: "ended", status: session.status }))
      ws.close(1000, "session ended")
    } catch {
      // ignore
    }
    void stop()
  }
  session.onEnd.add(onEnd)

  ws.on("message", (raw, isBinary) => {
    if (isBinary || closed) return
    let msg: unknown
    try {
      msg = JSON.parse(raw.toString("utf8"))
    } catch {
      return
    }
    void handleInput(page, msg).catch(() => undefined) // input errors are non-fatal; never logged with payload
  })

  ws.on("close", () => {
    session.onEnd.delete(onEnd)
    void stop()
  })
  ws.on("error", () => {
    session.onEnd.delete(onEnd)
    void stop()
  })

  ws.send(JSON.stringify({ type: "meta", viewport: page.viewportSize() ?? VIEWPORT }))
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 60,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
    everyNthFrame: 1,
  })
  log.info({ sessionId: session.sessionId }, "live view attached")
}

const MOUSE_BUTTONS = new Set(["left", "right", "middle"])

async function handleInput(page: Page, msg: unknown): Promise<void> {
  if (!msg || typeof msg !== "object") return
  const m = msg as Record<string, unknown>
  const vp = page.viewportSize() ?? VIEWPORT
  const num = (v: unknown, max: number): number | null => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : null
  }

  switch (m.type) {
    case "mouse": {
      const x = num(m.x, vp.width)
      const y = num(m.y, vp.height)
      if (x === null || y === null) return
      const button = MOUSE_BUTTONS.has(String(m.button)) ? (m.button as "left" | "right" | "middle") : "left"
      const clickCount = Math.max(1, Math.min(3, Number(m.clickCount) || 1))
      switch (m.action) {
        case "move":
          return page.mouse.move(x, y)
        case "down":
          await page.mouse.move(x, y)
          return page.mouse.down({ button, clickCount })
        case "up":
          return page.mouse.up({ button, clickCount })
        case "click":
          return page.mouse.click(x, y, { button, clickCount })
        default:
          return
      }
    }
    case "key": {
      switch (m.action) {
        case "down":
          if (typeof m.key === "string" && m.key.length <= 32) return page.keyboard.down(m.key)
          return
        case "up":
          if (typeof m.key === "string" && m.key.length <= 32) return page.keyboard.up(m.key)
          return
        case "press":
          if (typeof m.key === "string" && m.key.length <= 32) return page.keyboard.press(m.key)
          return
        case "type":
          if (typeof m.text === "string" && m.text.length <= 256) return page.keyboard.type(m.text)
          return
        default:
          return
      }
    }
    case "wheel": {
      const dx = Number(m.deltaX) || 0
      const dy = Number(m.deltaY) || 0
      const x = num(m.x, vp.width)
      const y = num(m.y, vp.height)
      if (x !== null && y !== null) await page.mouse.move(x, y)
      return page.mouse.wheel(Math.max(-2000, Math.min(2000, dx)), Math.max(-2000, Math.min(2000, dy)))
    }
    default:
      return
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}
