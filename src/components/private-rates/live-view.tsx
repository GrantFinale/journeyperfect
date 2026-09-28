"use client"

/**
 * Live view of the runner's browser during the interactive Hilton sign-in
 * (docs/plans/opportunity-discovery-engine.md §6.5).
 *
 * The runner streams CDP screencast frames (binary JPEG) over a WebSocket; we
 * draw them onto a canvas and forward mouse, wheel and key events back as JSON.
 * Frames are drawn and discarded, never stored (§6.4). Keystrokes go straight
 * to the runner's browser and are not read, logged or buffered here: the user
 * types their password into Hilton's page, and we never see it.
 *
 * Wire protocol (client → runner), one JSON object per message:
 *   { type: "mouse", action: "down"|"up"|"move", x, y, button, modifiers }
 *   { type: "wheel", x, y, deltaX, deltaY }
 *   { type: "key",   action: "down"|"up", key, code, text?, modifiers }
 * Runner → client: binary frames (JPEG), or JSON text such as
 *   { type: "signedIn" } | { type: "status", status: "SIGNED_IN" } | { type: "closed", reason? }
 */

import { useCallback, useEffect, useRef, useState } from "react"

type Props = {
  liveViewUrl: string
  onSignedIn?: () => void
  onClosed?: (reason?: string) => void
}

type Connection = "connecting" | "open" | "closed" | "error"

function modifiersOf(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  // CDP Input modifiers bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
}

function buttonName(button: number): "left" | "middle" | "right" | "none" {
  if (button === 0) return "left"
  if (button === 1) return "middle"
  if (button === 2) return "right"
  return "none"
}

export function LiveView({ liveViewUrl, onSignedIn, onClosed }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [connection, setConnection] = useState<Connection>("connecting")
  const [hasFrame, setHasFrame] = useState(false)
  const onSignedInRef = useRef(onSignedIn)
  const onClosedRef = useRef(onClosed)
  onSignedInRef.current = onSignedIn
  onClosedRef.current = onClosed

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
  }, [])

  // Map a pointer position on the displayed canvas to frame coordinates.
  const scaled = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const sx = rect.width > 0 ? canvas.width / rect.width : 1
    const sy = rect.height > 0 ? canvas.height / rect.height : 1
    return {
      x: Math.max(0, Math.round((clientX - rect.left) * sx)),
      y: Math.max(0, Math.round((clientY - rect.top) * sy)),
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let ws: WebSocket
    try {
      ws = new WebSocket(liveViewUrl)
    } catch {
      setConnection("error")
      return
    }
    ws.binaryType = "blob"
    wsRef.current = ws

    ws.onopen = () => {
      if (!disposed) setConnection("open")
    }
    ws.onerror = () => {
      if (!disposed) setConnection("error")
    }
    ws.onclose = (ev) => {
      if (disposed) return
      setConnection("closed")
      onClosedRef.current?.(ev.reason || undefined)
    }
    ws.onmessage = async (ev: MessageEvent) => {
      if (disposed) return
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data) as { type?: string; status?: string; reason?: string }
          if (msg.type === "signedIn" || (msg.type === "status" && msg.status === "SIGNED_IN")) onSignedInRef.current?.()
          else if (msg.type === "closed") onClosedRef.current?.(msg.reason)
        } catch {
          // ignore malformed control messages
        }
        return
      }
      const blob: Blob = ev.data instanceof Blob ? ev.data : new Blob([ev.data as ArrayBuffer], { type: "image/jpeg" })
      let bitmap: ImageBitmap
      try {
        bitmap = await createImageBitmap(blob)
      } catch {
        return
      }
      const canvas = canvasRef.current
      if (!canvas || disposed) {
        bitmap.close()
        return
      }
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width
        canvas.height = bitmap.height
      }
      const ctx = canvas.getContext("2d")
      ctx?.drawImage(bitmap, 0, 0)
      bitmap.close() // frame is never persisted
      setHasFrame(true)
    }

    return () => {
      disposed = true
      wsRef.current = null
      try {
        ws.close(1000, "view closed")
      } catch {
        // already closed
      }
    }
  }, [liveViewUrl])

  // Wheel must be non-passive to preventDefault, which React's onWheel cannot guarantee.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { x, y } = scaled(e.clientX, e.clientY)
      send({ type: "wheel", x, y, deltaX: Math.round(e.deltaX), deltaY: Math.round(e.deltaY), modifiers: modifiersOf(e) })
    }
    canvas.addEventListener("wheel", onWheel, { passive: false })
    return () => canvas.removeEventListener("wheel", onWheel)
  }, [scaled, send])

  const mouse = (action: "down" | "up" | "move") => (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = scaled(e.clientX, e.clientY)
    if (action === "down") canvasRef.current?.focus()
    send({ type: "mouse", action, x, y, button: buttonName(e.button), buttons: e.buttons, modifiers: modifiersOf(e) })
  }

  const key = (action: "down" | "up") => (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    // Keep browser shortcuts (Tab, Backspace navigation, etc.) inside the remote page.
    e.preventDefault()
    const text = action === "down" && e.key.length === 1 && !e.ctrlKey && !e.metaKey ? e.key : undefined
    send({ type: "key", action, key: e.key, code: e.code, text, modifiers: modifiersOf(e), repeat: e.repeat })
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Sign in on Hilton&apos;s page. We never see your password.
      </div>
      <div className="relative overflow-hidden rounded-lg border border-gray-300 bg-gray-900">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          width={1280}
          height={800}
          className="block w-full cursor-default outline-none focus:ring-2 focus:ring-indigo-500"
          onMouseDown={mouse("down")}
          onMouseUp={mouse("up")}
          onMouseMove={mouse("move")}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={key("down")}
          onKeyUp={key("up")}
          aria-label="Hilton sign-in page (live view)"
        />
        {(!hasFrame || connection !== "open") && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 text-sm text-gray-200">
            {connection === "connecting" && "Connecting to the secure browser…"}
            {connection === "open" && !hasFrame && "Waiting for the first frame…"}
            {connection === "closed" && "The live view has closed."}
            {connection === "error" && "Could not reach the secure browser."}
          </div>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Click into the page to type. Your keystrokes go directly to Hilton&apos;s page in an isolated browser we host;
        nothing is recorded.
      </p>
    </div>
  )
}
