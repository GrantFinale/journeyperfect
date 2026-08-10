"use server"

import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { revalidatePath } from "next/cache"
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAGIC_BYTE_PREFIX_LENGTH,
  MAX_ATTACHMENTS_PER_ITEM,
  MAX_ATTACHMENT_BYTES,
  MAX_TRIP_ATTACHMENT_BYTES,
  formatBytes,
  magicBytesMatch,
  normalizeAttachmentKind,
  sanitizeFileName,
  type AttachmentKindValue,
  type AttachmentMeta,
} from "./attachments-shared"

/**
 * Metadata-only projection. `data` is deliberately absent: it is a bytea
 * column, and Prisma selects every scalar by default, so any query that omits
 * this `select` would stream whole files out of Postgres.
 */
const META_SELECT = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  kind: true,
  createdAt: true,
} as const

type MetaRow = {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  kind: string
  createdAt: Date
}

function toMeta(tripId: string, row: MetaRow): AttachmentMeta {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    kind: row.kind as AttachmentKindValue,
    createdAt: row.createdAt.toISOString(),
    url: `/api/trip/${tripId}/attachment/${row.id}`,
  }
}

/**
 * Attachment metadata for one itinerary event, oldest first.
 * Never selects `data` — see META_SELECT.
 */
export async function listAttachments(
  tripId: string,
  itineraryItemId: string
): Promise<AttachmentMeta[]> {
  await requireTripAccess(tripId)

  const rows = await prisma.eventAttachment.findMany({
    where: { tripId, itineraryItemId },
    select: META_SELECT,
    orderBy: { createdAt: "asc" },
  })

  return rows.map((row) => toMeta(tripId, row))
}

/**
 * Store one file against an itinerary event.
 *
 * Everything here is validated server-side; the client's declared size and
 * MIME type are treated as hints only. Bytes go straight into Postgres, so the
 * caps are load-bearing rather than cosmetic.
 */
export async function uploadAttachment(
  tripId: string,
  itineraryItemId: string,
  form: FormData
): Promise<AttachmentMeta> {
  const access = await requireTripAccess(tripId, "EDITOR")

  const entry = form.get("file")
  if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function") {
    throw new Error("No file was provided.")
  }
  const file = entry as File
  const kind = normalizeAttachmentKind(form.get("kind"))

  // The item must belong to this trip, otherwise a guessed id from another
  // trip could be used to hang files off someone else's itinerary.
  const item = await prisma.itineraryItem.findFirst({
    where: { id: itineraryItemId, tripId },
    select: { id: true },
  })
  if (!item) {
    throw new Error("That itinerary item doesn't belong to this trip.")
  }

  // Cheap rejection on the declared size before we buffer anything.
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Files must be ${formatBytes(MAX_ATTACHMENT_BYTES)} or smaller. "${sanitizeFileName(
        file.name
      )}" is ${formatBytes(file.size)}.`
    )
  }

  const declaredType = (file.type || "").toLowerCase().split(";")[0].trim()
  if (!ALLOWED_ATTACHMENT_TYPES.includes(declaredType)) {
    throw new Error(
      "Only PDF, JPEG, PNG, WebP and HEIC/HEIF files can be attached to an event."
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  // Re-check against the real payload: `file.size` is client-supplied metadata.
  if (bytes.byteLength === 0) {
    throw new Error("That file is empty.")
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Files must be ${formatBytes(MAX_ATTACHMENT_BYTES)} or smaller. That one is ${formatBytes(
        bytes.byteLength
      )}.`
    )
  }

  // Content must actually be what it claims to be, so an executable renamed
  // .pdf can't be stored now and served back later.
  if (!magicBytesMatch(declaredType, bytes.subarray(0, MAGIC_BYTE_PREFIX_LENGTH))) {
    throw new Error(
      "That file's contents don't match its file type. Upload a real PDF or image."
    )
  }

  const [itemCount, tripTotals] = await Promise.all([
    prisma.eventAttachment.count({ where: { tripId, itineraryItemId } }),
    prisma.eventAttachment.aggregate({ where: { tripId }, _sum: { sizeBytes: true } }),
  ])

  if (itemCount >= MAX_ATTACHMENTS_PER_ITEM) {
    throw new Error(
      `An event can hold up to ${MAX_ATTACHMENTS_PER_ITEM} attachments. Remove one before adding another.`
    )
  }

  const tripUsed = tripTotals._sum.sizeBytes ?? 0
  if (tripUsed + bytes.byteLength > MAX_TRIP_ATTACHMENT_BYTES) {
    throw new Error(
      `This trip has used ${formatBytes(tripUsed)} of its ${formatBytes(
        MAX_TRIP_ATTACHMENT_BYTES
      )} attachment allowance. Delete some attachments to free up space.`
    )
  }

  const created = await prisma.eventAttachment.create({
    data: {
      tripId,
      itineraryItemId,
      fileName: sanitizeFileName(file.name),
      mimeType: declaredType,
      sizeBytes: bytes.byteLength,
      kind,
      data: bytes,
      uploadedById: access.userId,
    },
    select: META_SELECT,
  })

  revalidatePath(`/trip/${tripId}/itinerary`)
  return toMeta(tripId, created)
}

export async function deleteAttachment(tripId: string, attachmentId: string): Promise<void> {
  await requireTripAccess(tripId, "EDITOR")

  // Scope the lookup by tripId so an id from another trip can't be deleted.
  const existing = await prisma.eventAttachment.findFirst({
    where: { id: attachmentId, tripId },
    select: { id: true },
  })
  if (!existing) {
    throw new Error("Attachment not found.")
  }

  await prisma.eventAttachment.delete({ where: { id: existing.id } })
  revalidatePath(`/trip/${tripId}/itinerary`)
}
