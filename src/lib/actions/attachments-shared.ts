/**
 * Constants, types and pure validators for event attachments.
 *
 * This module is deliberately free of server-only imports (no prisma, no auth)
 * so it can be pulled into a client bundle for optimistic validation, and so
 * the pure helpers are unit-testable without a database.
 *
 * It is re-exported from `@/lib/actions/attachments`, which is the module the
 * UI imports. It lives here rather than in that file because a `"use server"`
 * file may only export async functions — Next's SWC transform errors with
 * "Only async functions are allowed to be exported in a 'use server' file."
 */

export type AttachmentKindValue =
  | "VOUCHER"
  | "RECEIPT"
  | "TICKET"
  | "CONFIRMATION"
  | "OTHER"

export interface AttachmentMeta {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  kind: AttachmentKindValue
  createdAt: string
  /** `/api/trip/<tripId>/attachment/<id>` — auth-checked streaming endpoint. */
  url: string
}

export const ATTACHMENT_KINDS: readonly AttachmentKindValue[] = [
  "VOUCHER",
  "RECEIPT",
  "TICKET",
  "CONFIRMATION",
  "OTHER",
]

/**
 * Attachment bytes live in the managed Postgres instance, which has a fixed
 * shared disk, and every stored byte is copied into every backup. The caps
 * below are the only thing standing between a few enthusiastic users and a
 * full volume, so they are enforced server-side on every upload.
 */

/** Largest single file we will accept: 5 MB. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

/** Largest number of files on one itinerary event. */
export const MAX_ATTACHMENTS_PER_ITEM = 10

/** Largest total attachment payload for one trip: 50 MB. */
export const MAX_TRIP_ATTACHMENT_BYTES = 50 * 1024 * 1024

/** Longest stored file name, in characters. */
export const MAX_FILE_NAME_LENGTH = 120

/** Bytes of the file head we inspect when sniffing the real format. */
export const MAGIC_BYTE_PREFIX_LENGTH = 32

/**
 * Client-declared MIME types we accept. The declared type is only a hint —
 * `magicBytesMatch` re-checks the actual content before anything is stored.
 */
export const ALLOWED_ATTACHMENT_TYPES: string[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]

/**
 * Types safe to render inline in the app's own origin. Anything outside this
 * set is forced to a download by the streaming route so stored bytes can never
 * execute as active content in the user's session.
 */
export const INLINE_SAFE_TYPES: string[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]

/** HEIC and HEIF share one container; browsers report either for the same file. */
const HEIF_FAMILY = new Set(["image/heic", "image/heif"])

/**
 * Strip a user- or OS-supplied file name down to something safe to store and
 * to echo back in a Content-Disposition header.
 *
 * Removes directory components (both separators), control characters and
 * characters that are reserved on common filesystems, refuses names that are
 * only dots (`.`, `..`), and caps the length while preserving the extension.
 */
export function sanitizeFileName(raw: unknown): string {
  const fallback = "attachment"
  if (typeof raw !== "string") return fallback

  // Take only the final path segment, so "../../etc/passwd" -> "passwd"
  // and "C:\\Users\\me\\voucher.pdf" -> "voucher.pdf".
  const base = raw.split(/[\\/]/).pop() ?? ""

  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "") // control characters, incl. NUL and newlines
    .replace(/[<>:"|?*]/g, "") // reserved on Windows / awkward in headers
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "") // no leading dots: kills "." and ".." and hidden files
    .trim()

  if (!cleaned) return fallback
  return capFileNameLength(cleaned, MAX_FILE_NAME_LENGTH)
}

function capFileNameLength(name: string, max: number): string {
  if (name.length <= max) return name

  const dot = name.lastIndexOf(".")
  // Only treat a trailing segment as an extension if it's short and not the
  // whole name, otherwise we'd "preserve" half the file name.
  const hasExt = dot > 0 && name.length - dot <= 11
  const ext = hasExt ? name.slice(dot) : ""
  const stem = hasExt ? name.slice(0, dot) : name

  return stem.slice(0, Math.max(1, max - ext.length)) + ext
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = ""
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i])
  return out
}

/**
 * Identify a file from its leading magic bytes, ignoring any declared type.
 * Returns null when the head matches none of the formats we accept — which is
 * how an executable renamed `.pdf` gets rejected.
 */
export function sniffMimeType(bytes: Uint8Array | undefined | null): string | null {
  if (!bytes || bytes.length < 4) return null
  const b = bytes

  // PDF: "%PDF"
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return "application/pdf"
  }

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg"
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "image/png"
  }

  // WebP: "RIFF" <4-byte size> "WEBP"
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") {
    return "image/webp"
  }

  // HEIC / HEIF: ISO base media file format — "ftyp" box at offset 4,
  // brand at offset 8.
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12).toLowerCase()
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"].includes(brand)) {
      return "image/heic"
    }
    if (["mif1", "msf1", "heif"].includes(brand)) {
      return "image/heif"
    }
  }

  return null
}

/**
 * True when the file's actual content matches the type the client declared.
 * A declared type we don't recognise, or content we can't identify, is a
 * mismatch — the allowlist and the sniffer must agree before we store bytes.
 */
export function magicBytesMatch(
  declaredMimeType: string,
  head: Uint8Array | undefined | null
): boolean {
  const sniffed = sniffMimeType(head)
  if (!sniffed) return false

  const declared = declaredMimeType.toLowerCase()
  if (sniffed === declared) return true

  return HEIF_FAMILY.has(sniffed) && HEIF_FAMILY.has(declared)
}

/** Human-readable byte size for error messages ("5 MB", "1.4 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / (1024 * 1024)
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`
}

/** Coerce arbitrary form input into a valid AttachmentKind, defaulting to OTHER. */
export function normalizeAttachmentKind(raw: unknown): AttachmentKindValue {
  if (typeof raw !== "string") return "OTHER"
  const upper = raw.toUpperCase()
  return (ATTACHMENT_KINDS as readonly string[]).includes(upper)
    ? (upper as AttachmentKindValue)
    : "OTHER"
}
