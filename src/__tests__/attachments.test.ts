import { describe, it, expect } from "vitest"
import {
  MAX_FILE_NAME_LENGTH,
  magicBytesMatch,
  normalizeAttachmentKind,
  sanitizeFileName,
  sniffMimeType,
} from "@/lib/actions/attachments-shared"

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function withAscii(prefixLength: number, text: string, tail: number[] = []): Uint8Array {
  const head = new Array(prefixLength).fill(0)
  const chars = [...text].map((c) => c.charCodeAt(0))
  return new Uint8Array([...head, ...chars, ...tail])
}

const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37)
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d)

function riff(fourcc: string): Uint8Array {
  const out = new Uint8Array(12)
  const write = (text: string, at: number) => {
    for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i)
  }
  write("RIFF", 0)
  out[4] = 0x24
  write(fourcc, 8)
  return out
}

function isoBmff(brand: string): Uint8Array {
  const out = new Uint8Array(16)
  out[3] = 0x18
  const write = (text: string, at: number) => {
    for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i)
  }
  write("ftyp", 4)
  write(brand, 8)
  return out
}

describe("sanitizeFileName", () => {
  it("keeps an ordinary file name unchanged", () => {
    expect(sanitizeFileName("hotel-voucher.pdf")).toBe("hotel-voucher.pdf")
  })

  it.each([
    ["../../etc/passwd", "passwd"],
    ["/absolute/path/receipt.pdf", "receipt.pdf"],
    ["C:\\Users\\me\\ticket.png", "ticket.png"],
    ["nested\\mixed/sep/voucher.jpg", "voucher.jpg"],
  ])("strips path separators from %s", (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected)
  })

  it("removes control characters", () => {
    expect(sanitizeFileName("re\u0000ce\u001Fipt\u007F.pdf")).toBe("receipt.pdf")
    expect(sanitizeFileName("line\nbreak.pdf")).toBe("linebreak.pdf")
  })

  it("removes characters that would break a Content-Disposition header", () => {
    expect(sanitizeFileName('we"ird<name>.pdf')).toBe("weirdname.pdf")
  })

  it("falls back for names that are only dots or empty", () => {
    expect(sanitizeFileName("..")).toBe("attachment")
    expect(sanitizeFileName(".")).toBe("attachment")
    expect(sanitizeFileName("   ")).toBe("attachment")
    expect(sanitizeFileName("")).toBe("attachment")
  })

  it("falls back for non-string input", () => {
    expect(sanitizeFileName(undefined)).toBe("attachment")
    expect(sanitizeFileName(null)).toBe("attachment")
    expect(sanitizeFileName(42)).toBe("attachment")
  })

  it("caps the length while preserving the extension", () => {
    const long = `${"a".repeat(400)}.pdf`
    const result = sanitizeFileName(long)

    expect(result.length).toBeLessThanOrEqual(MAX_FILE_NAME_LENGTH)
    expect(result.endsWith(".pdf")).toBe(true)
  })

  it("caps extensionless names too", () => {
    const result = sanitizeFileName("b".repeat(500))
    expect(result.length).toBe(MAX_FILE_NAME_LENGTH)
  })
})

describe("sniffMimeType", () => {
  it("identifies PDF", () => {
    expect(sniffMimeType(PDF)).toBe("application/pdf")
  })

  it("identifies JPEG", () => {
    expect(sniffMimeType(JPEG)).toBe("image/jpeg")
  })

  it("identifies PNG", () => {
    expect(sniffMimeType(PNG)).toBe("image/png")
  })

  it("identifies WebP", () => {
    expect(sniffMimeType(riff("WEBP"))).toBe("image/webp")
  })

  it("rejects a RIFF container that is not WebP (e.g. WAV)", () => {
    expect(sniffMimeType(riff("WAVE"))).toBeNull()
  })

  it("identifies HEIC and HEIF brands", () => {
    expect(sniffMimeType(isoBmff("heic"))).toBe("image/heic")
    expect(sniffMimeType(isoBmff("mif1"))).toBe("image/heif")
  })

  it.each([
    ["ELF executable", bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00)],
    ["Mach-O executable", bytes(0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01)],
    ["Windows PE", bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00)],
    ["ZIP / Office doc", bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00)],
    ["shell script", bytes(0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x73)],
    ["HTML", withAscii(0, "<html>", [])],
  ])("returns null for %s", (_label, sample) => {
    expect(sniffMimeType(sample)).toBeNull()
  })

  it("returns null for empty or truncated input", () => {
    expect(sniffMimeType(new Uint8Array(0))).toBeNull()
    expect(sniffMimeType(bytes(0x25, 0x50))).toBeNull()
    expect(sniffMimeType(null)).toBeNull()
    expect(sniffMimeType(undefined)).toBeNull()
  })

  it("does not accept a PDF signature that is not at the start", () => {
    expect(sniffMimeType(withAscii(4, "%PDF-1.7"))).toBeNull()
  })
})

describe("magicBytesMatch", () => {
  it("accepts content that matches the declared type", () => {
    expect(magicBytesMatch("application/pdf", PDF)).toBe(true)
    expect(magicBytesMatch("image/jpeg", JPEG)).toBe(true)
    expect(magicBytesMatch("image/png", PNG)).toBe(true)
    expect(magicBytesMatch("image/webp", riff("WEBP"))).toBe(true)
  })

  it("rejects an executable renamed as a PDF", () => {
    const elf = bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00)
    expect(magicBytesMatch("application/pdf", elf)).toBe(false)
  })

  it("rejects a real image declared as a different image type", () => {
    expect(magicBytesMatch("image/png", JPEG)).toBe(false)
    expect(magicBytesMatch("application/pdf", PNG)).toBe(false)
  })

  it("treats HEIC and HEIF as interchangeable", () => {
    expect(magicBytesMatch("image/heif", isoBmff("heic"))).toBe(true)
    expect(magicBytesMatch("image/heic", isoBmff("mif1"))).toBe(true)
  })

  it("is case-insensitive about the declared type", () => {
    expect(magicBytesMatch("APPLICATION/PDF", PDF)).toBe(true)
  })

  it("rejects when the content cannot be identified at all", () => {
    expect(magicBytesMatch("application/pdf", new Uint8Array(0))).toBe(false)
    expect(magicBytesMatch("image/png", null)).toBe(false)
  })
})

describe("normalizeAttachmentKind", () => {
  it("accepts known kinds in any case", () => {
    expect(normalizeAttachmentKind("VOUCHER")).toBe("VOUCHER")
    expect(normalizeAttachmentKind("receipt")).toBe("RECEIPT")
  })

  it("falls back to OTHER for anything unknown", () => {
    expect(normalizeAttachmentKind("NOT_A_KIND")).toBe("OTHER")
    expect(normalizeAttachmentKind(null)).toBe("OTHER")
    expect(normalizeAttachmentKind(undefined)).toBe("OTHER")
    expect(normalizeAttachmentKind(7)).toBe("OTHER")
  })
})
