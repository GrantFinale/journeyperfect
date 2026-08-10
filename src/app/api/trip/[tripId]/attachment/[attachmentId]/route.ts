import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { INLINE_SAFE_TYPES } from "@/lib/actions/attachments-shared"

export const dynamic = "force-dynamic"

/**
 * Stream a single event attachment.
 *
 * Attachments are receipts, vouchers and tickets, so access is checked on
 * every request — a guessed id must not be fetchable without trip access.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tripId: string; attachmentId: string }> }
) {
  const { tripId, attachmentId } = await params

  try {
    await requireTripAccess(tripId)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Scoped by tripId: an attachment belonging to another trip is a 404 here,
  // even for a caller who legitimately has access to this one.
  const attachment = await prisma.eventAttachment.findFirst({
    where: { id: attachmentId, tripId },
    select: { fileName: true, mimeType: true, data: true },
  })
  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const body = new Uint8Array(attachment.data)

  // Anything we wouldn't render safely is forced to download, so stored bytes
  // can never execute as active content on this origin. Paired with nosniff,
  // the browser also can't second-guess the declared type.
  const disposition = INLINE_SAFE_TYPES.includes(attachment.mimeType) ? "inline" : "attachment"

  return new NextResponse(body, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${disposition}; ${contentDispositionFilename(attachment.fileName)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

/**
 * Build the filename parameters for Content-Disposition: a quoted ASCII
 * fallback with quotes/backslashes/control characters neutralised, plus an
 * RFC 5987 encoded form so non-ASCII names survive intact.
 */
function contentDispositionFilename(name: string): string {
  const fallback =
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x20-\x7E]/g, "_") // non-ASCII and control characters
      .replace(/["\\]/g, "_") // would terminate or escape the quoted string
      .trim() || "attachment"

  return `filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
