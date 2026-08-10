/**
 * Event attachments — public module surface.
 *
 * Import everything attachment-related from here:
 *
 *   import {
 *     listAttachments, uploadAttachment, deleteAttachment,
 *     MAX_ATTACHMENT_BYTES, ALLOWED_ATTACHMENT_TYPES,
 *     type AttachmentMeta, type AttachmentKindValue,
 *   } from "@/lib/actions/attachments"
 *
 * This file is a barrel rather than the `"use server"` module itself because a
 * `"use server"` file may only export async functions — Next's SWC transform
 * fails the build with "Only async functions are allowed to be exported in a
 * 'use server' file." if it also exports constants. Splitting keeps the
 * constants importable while the actions stay real server actions: the
 * `"use server"` module is replaced by client references in client bundles, so
 * prisma never reaches the browser.
 */

export type { AttachmentKindValue, AttachmentMeta } from "./attachments-shared"

export {
  ALLOWED_ATTACHMENT_TYPES,
  ATTACHMENT_KINDS,
  INLINE_SAFE_TYPES,
  MAGIC_BYTE_PREFIX_LENGTH,
  MAX_ATTACHMENTS_PER_ITEM,
  MAX_ATTACHMENT_BYTES,
  MAX_FILE_NAME_LENGTH,
  MAX_TRIP_ATTACHMENT_BYTES,
  formatBytes,
  magicBytesMatch,
  normalizeAttachmentKind,
  sanitizeFileName,
  sniffMimeType,
} from "./attachments-shared"

export { deleteAttachment, listAttachments, uploadAttachment } from "./attachments-actions"
