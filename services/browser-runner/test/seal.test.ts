import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  SEAL_HEADER_BYTES,
  deriveKey,
  destroySealed,
  hasSealed,
  isValidUserId,
  readSealHeader,
  sealProfile,
  sealedPath,
  unsealProfile,
  wipeDir,
} from "../src/seal.js"

const masterKey = randomBytes(32)
let root: string
let ctx: { dataDir: string; masterKey: Buffer }
let scratch: string

async function makeProfile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(root, "profile-"))
  await fs.mkdir(path.join(dir, "Default", "Cache"), { recursive: true })
  await fs.mkdir(path.join(dir, "Default", "Local Storage", "leveldb"), { recursive: true })
  await fs.writeFile(path.join(dir, "Local State"), JSON.stringify({ profile: { info_cache: {} } }))
  await fs.writeFile(path.join(dir, "Default", "Cookies"), randomBytes(64 * 1024))
  await fs.writeFile(path.join(dir, "Default", "Local Storage", "leveldb", "000003.log"), randomBytes(4096))
  await fs.writeFile(path.join(dir, "Default", "Cache", "data_0"), randomBytes(2048))
  await fs.writeFile(path.join(dir, "SingletonLock"), "host-1234")
  return dir
}

async function listFiles(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>()
  const walk = async (d: string) => {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name)
      if (entry.isDirectory()) await walk(p)
      else out.set(path.relative(dir, p), await fs.readFile(p))
    }
  }
  await walk(dir)
  return out
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "seal-test-"))
  scratch = path.join(root, "scratch")
  await fs.mkdir(scratch)
  ctx = { dataDir: path.join(root, "data"), masterKey }
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe("isValidUserId", () => {
  it("accepts plain tokens and rejects path-ish input", () => {
    expect(isValidUserId("cm1abc_DEF-123")).toBe(true)
    expect(isValidUserId("../etc")).toBe(false)
    expect(isValidUserId("a/b")).toBe(false)
    expect(isValidUserId("")).toBe(false)
    expect(isValidUserId(42)).toBe(false)
  })
})

describe("deriveKey", () => {
  it("is deterministic per user and differs between users", () => {
    const a1 = deriveKey(masterKey, "user-a")
    const a2 = deriveKey(masterKey, "user-a")
    const b = deriveKey(masterKey, "user-b")
    expect(a1.equals(a2)).toBe(true)
    expect(a1.equals(b)).toBe(false)
    expect(a1.length).toBe(32)
  })
})

describe("seal / unseal", () => {
  it("round-trips a profile directory, skipping cache and lock files", async () => {
    const profile = await makeProfile()
    const before = await listFiles(profile)

    const sealed = await sealProfile("user-a", profile, ctx)
    expect(sealed.path).toBe(sealedPath(ctx, "user-a"))
    expect(sealed.bytes).toBeGreaterThan(SEAL_HEADER_BYTES)
    expect(await hasSealed("user-a", ctx)).toBe(true)

    const header = await readSealHeader(sealed.path)
    expect(header.keyVersion).toBe(1)
    expect(header.iv.length).toBe(12)
    expect(header.tag.length).toBe(16)
    expect(header.tag.equals(Buffer.alloc(16))).toBe(false)

    // Ciphertext must not contain the plaintext.
    const blob = await fs.readFile(sealed.path)
    expect(blob.includes(Buffer.from("info_cache"))).toBe(false)

    const restored = await unsealProfile("user-a", ctx, { scratchBase: scratch })
    expect(restored).not.toBeNull()
    expect(restored!.startsWith(scratch)).toBe(true)
    const after = await listFiles(restored!)

    for (const [rel, content] of before) {
      const excluded = rel.startsWith(path.join("Default", "Cache")) || rel === "SingletonLock"
      if (excluded) {
        expect(after.has(rel), `${rel} should be excluded`).toBe(false)
      } else {
        expect(after.get(rel)?.equals(content), rel).toBe(true)
      }
    }
    expect((await fs.stat(restored!)).mode & 0o777).toBe(0o700)
    await wipeDir(restored)
    await expect(fs.stat(restored!)).rejects.toThrow()
  })

  it("returns null when the user has no sealed profile", async () => {
    expect(await unsealProfile("nobody", ctx, { scratchBase: scratch })).toBeNull()
    expect(await hasSealed("nobody", ctx)).toBe(false)
  })

  it("refuses to open one user's blob as another user and leaves no scratch dir behind", async () => {
    const profile = await makeProfile()
    await sealProfile("user-a", profile, ctx)
    await fs.copyFile(sealedPath(ctx, "user-a"), sealedPath(ctx, "user-b"))
    await expect(unsealProfile("user-b", ctx, { scratchBase: scratch })).rejects.toThrow(/unseal failed/)
    expect(await fs.readdir(scratch)).toEqual([])
  })

  it("detects tampering with the ciphertext", async () => {
    const profile = await makeProfile()
    const { path: file } = await sealProfile("user-a", profile, ctx)
    const fh = await fs.open(file, "r+")
    try {
      const b = Buffer.alloc(1)
      await fh.read(b, 0, 1, SEAL_HEADER_BYTES + 100)
      b[0] ^= 0xff
      await fh.write(b, 0, 1, SEAL_HEADER_BYTES + 100)
    } finally {
      await fh.close()
    }
    await expect(unsealProfile("user-a", ctx, { scratchBase: scratch })).rejects.toThrow(/unseal failed/)
    expect(await fs.readdir(scratch)).toEqual([])
  })

  it("re-sealing replaces the blob atomically with a fresh iv", async () => {
    const profile = await makeProfile()
    const first = await sealProfile("user-a", profile, ctx)
    const h1 = await readSealHeader(first.path)
    await fs.writeFile(path.join(profile, "Default", "Cookies"), randomBytes(1024))
    const second = await sealProfile("user-a", profile, ctx)
    const h2 = await readSealHeader(second.path)
    expect(h1.iv.equals(h2.iv)).toBe(false)
    const files = await fs.readdir(path.dirname(first.path))
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
    expect(files).toEqual(["user-a.bin"])
  })

  it("destroySealed removes the blob and reports whether one existed", async () => {
    const profile = await makeProfile()
    await sealProfile("user-a", profile, ctx)
    expect(await destroySealed("user-a", ctx)).toBe(true)
    expect(await hasSealed("user-a", ctx)).toBe(false)
    expect(await destroySealed("user-a", ctx)).toBe(false)
  })

  it("rejects invalid user ids before touching the filesystem", async () => {
    await expect(sealProfile("../x", root, ctx)).rejects.toThrow(/invalid userId/)
    await expect(unsealProfile("a/b", ctx)).rejects.toThrow(/invalid userId/)
  })
})
