import { describe, it, expect, vi, beforeEach } from "vitest"

const mockApiKey = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: { apiKey: mockApiKey },
}))

import { authenticateApiKey, generateApiKey, hashApiKey, parseBearerApiKey } from "@/lib/mcp/auth"

describe("API key generation", () => {
  it("produces jp_-prefixed keys with an 8-char display prefix and a sha256 hash", () => {
    const key = generateApiKey()
    expect(key.plaintext).toMatch(/^jp_[A-Za-z0-9_-]{43}$/)
    expect(key.prefix).toBe(key.plaintext.slice(3, 11))
    expect(key.keyHash).toBe(hashApiKey(key.plaintext))
    expect(key.keyHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateApiKey().plaintext))
    expect(seen.size).toBe(50)
  })
})

describe("parseBearerApiKey", () => {
  const key = generateApiKey().plaintext

  it("accepts a well-formed bearer header", () => {
    expect(parseBearerApiKey(`Bearer ${key}`)).toBe(key)
    expect(parseBearerApiKey(`bearer ${key}`)).toBe(key)
  })

  it("rejects everything else", () => {
    expect(parseBearerApiKey(null)).toBeNull()
    expect(parseBearerApiKey("")).toBeNull()
    expect(parseBearerApiKey(key)).toBeNull()
    expect(parseBearerApiKey("Basic abc")).toBeNull()
    expect(parseBearerApiKey("Bearer jp_short")).toBeNull()
    expect(parseBearerApiKey("Bearer sk_" + "a".repeat(43))).toBeNull()
  })
})

describe("authenticateApiKey", () => {
  beforeEach(() => {
    mockApiKey.findUnique.mockReset()
    mockApiKey.update.mockReset()
    mockApiKey.update.mockReturnValue({ catch: () => undefined })
  })

  it("resolves an active key to its owner and stamps lastUsedAt", async () => {
    const key = generateApiKey()
    mockApiKey.findUnique.mockResolvedValue({ id: "k1", userId: "u1", revokedAt: null })

    const principal = await authenticateApiKey(`Bearer ${key.plaintext}`)

    expect(principal).toEqual({ userId: "u1", keyId: "k1" })
    expect(mockApiKey.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { keyHash: key.keyHash } })
    )
    expect(mockApiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "k1" } })
    )
  })

  it("rejects revoked keys", async () => {
    mockApiKey.findUnique.mockResolvedValue({ id: "k1", userId: "u1", revokedAt: new Date() })
    expect(await authenticateApiKey(`Bearer ${generateApiKey().plaintext}`)).toBeNull()
    expect(mockApiKey.update).not.toHaveBeenCalled()
  })

  it("rejects unknown keys and malformed headers without hitting the database", async () => {
    mockApiKey.findUnique.mockResolvedValue(null)
    expect(await authenticateApiKey(`Bearer ${generateApiKey().plaintext}`)).toBeNull()

    mockApiKey.findUnique.mockClear()
    expect(await authenticateApiKey("Bearer nope")).toBeNull()
    expect(await authenticateApiKey(null)).toBeNull()
    expect(mockApiKey.findUnique).not.toHaveBeenCalled()
  })
})
