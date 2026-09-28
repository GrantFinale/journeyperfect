/**
 * Sealed Chromium profiles (§6.4).
 *
 *   seal:    tar(profileDir) → AES-256-GCM → ${DATA_DIR}/sealed/${userId}.bin
 *   unseal:  ${DATA_DIR}/sealed/${userId}.bin → AES-256-GCM⁻¹ → tar -x into a fresh
 *            scratch dir (/dev/shm when writable and roomy, else os.tmpdir())
 *
 * Key = HKDF-SHA256(masterKey, salt="jp-private-rates", info=userId, 32 bytes).
 * The master key never leaves this service. A user's key can only ever open
 * that user's blob: unsealing with the wrong userId fails authentication.
 *
 * File layout (fixed 33-byte header, then ciphertext):
 *   [0..4)   magic "JPSP"
 *   [4]      keyVersion (1)
 *   [5..17)  iv  (12 bytes)
 *   [17..33) tag (16 bytes)  — written after the stream finishes
 *
 * Streaming caveat: GCM only authenticates at the end, so tar has already
 * extracted plaintext by the time a bad tag is detected. On failure the scratch
 * dir is wiped before the error is raised. Callers wipe the scratch dir in a
 * `finally` regardless of outcome.
 *
 * Nothing here logs anything: paths yes, contents never.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process"
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"
import { accessSync, constants as fsConstants, createReadStream, createWriteStream, statfsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Readable, Writable } from "node:stream"
import { pipeline } from "node:stream/promises"

export const SEAL_MAGIC = Buffer.from("JPSP", "ascii")
export const SEAL_KEY_VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16
const TAG_OFFSET = SEAL_MAGIC.length + 1 + IV_BYTES
export const SEAL_HEADER_BYTES = TAG_OFFSET + TAG_BYTES // 33
const HKDF_SALT = "jp-private-rates"
const SHM_MIN_FREE_BYTES = 512 * 1024 * 1024

export interface SealContext {
  dataDir: string
  masterKey: Buffer
}

export interface SealHeader {
  keyVersion: number
  iv: Buffer
  tag: Buffer
}

const USER_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

/** userIds become file names; refuse anything that is not a plain token. */
export function isValidUserId(userId: unknown): userId is string {
  return typeof userId === "string" && USER_ID_RE.test(userId)
}

export function assertUserId(userId: string): void {
  if (!isValidUserId(userId)) throw new Error("invalid userId")
}

export function deriveKey(masterKey: Buffer, userId: string, keyVersion = SEAL_KEY_VERSION): Buffer {
  assertUserId(userId)
  const info = keyVersion === 1 ? userId : `${userId}:v${keyVersion}`
  return Buffer.from(hkdfSync("sha256", masterKey, HKDF_SALT, info, 32))
}

export function sealedPath(ctx: SealContext, userId: string): string {
  assertUserId(userId)
  return path.join(ctx.dataDir, "sealed", `${userId}.bin`)
}

/**
 * Chromium scratch state that is large and regenerable. Patterns are
 * unanchored so they work with both GNU tar (container) and bsdtar (macOS dev).
 */
const TAR_EXCLUDES = [
  "SingletonLock",
  "SingletonSocket",
  "SingletonCookie",
  "lockfile",
  "Default/Cache",
  "Default/Code Cache",
  "Default/GPUCache",
  "Default/DawnCache",
  "Default/DawnGraphiteCache",
  "Default/DawnWebGPUCache",
  "Default/Service Worker/CacheStorage",
  "Default/Service Worker/ScriptCache",
  "GrShaderCache",
  "ShaderCache",
  "GraphiteDawnCache",
  "BrowserMetrics",
  "Crashpad",
]

type TarProc = ChildProcessByStdio<Writable, Readable, Readable>

function runTar(args: string[]): { proc: TarProc; done: Promise<void> } {
  const proc = spawn("tar", args, { stdio: ["pipe", "pipe", "pipe"] })
  let stderr = ""
  proc.stderr.setEncoding("utf8")
  proc.stderr.on("data", (chunk: string) => {
    if (stderr.length < 4000) stderr += chunk
  })
  const done = new Promise<void>((resolve, reject) => {
    proc.once("error", reject)
    proc.once("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar exited with code ${code}: ${stderr.trim().slice(0, 500)}`))
    })
  })
  return { proc, done }
}

export async function sealProfile(
  userId: string,
  profileDir: string,
  ctx: SealContext,
): Promise<{ path: string; bytes: number }> {
  const key = deriveKey(ctx.masterKey, userId)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key, iv)

  const finalPath = sealedPath(ctx, userId)
  await fs.mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 })
  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`

  const header = Buffer.alloc(SEAL_HEADER_BYTES, 0)
  SEAL_MAGIC.copy(header, 0)
  header[SEAL_MAGIC.length] = SEAL_KEY_VERSION
  iv.copy(header, SEAL_MAGIC.length + 1)

  const tar = runTar(["-cf", "-", ...TAR_EXCLUDES.map((e) => `--exclude=${e}`), "-C", profileDir, "."])
  tar.proc.stdin.end()
  const out = createWriteStream(tmpPath, { mode: 0o600 })

  try {
    await new Promise<void>((resolve, reject) => out.write(header, (err) => (err ? reject(err) : resolve())))
    await Promise.all([pipeline(tar.proc.stdout, cipher, out), tar.done])
    const tag = cipher.getAuthTag()
    const fh = await fs.open(tmpPath, "r+")
    try {
      await fh.write(tag, 0, TAG_BYTES, TAG_OFFSET)
    } finally {
      await fh.close()
    }
    await fs.rename(tmpPath, finalPath)
    const { size } = await fs.stat(finalPath)
    return { path: finalPath, bytes: size }
  } catch (err) {
    tar.proc.kill()
    out.destroy()
    await fs.rm(tmpPath, { force: true })
    throw err
  }
}

export async function readSealHeader(file: string): Promise<SealHeader> {
  const fh = await fs.open(file, "r")
  try {
    const buf = Buffer.alloc(SEAL_HEADER_BYTES)
    const { bytesRead } = await fh.read(buf, 0, SEAL_HEADER_BYTES, 0)
    if (bytesRead !== SEAL_HEADER_BYTES || !buf.subarray(0, SEAL_MAGIC.length).equals(SEAL_MAGIC)) {
      throw new Error("sealed blob has an invalid header")
    }
    return {
      keyVersion: buf[SEAL_MAGIC.length],
      iv: Buffer.from(buf.subarray(SEAL_MAGIC.length + 1, TAG_OFFSET)),
      tag: Buffer.from(buf.subarray(TAG_OFFSET, SEAL_HEADER_BYTES)),
    }
  } finally {
    await fh.close()
  }
}

export interface UnsealOptions {
  /** Override the scratch base directory (tests). */
  scratchBase?: string
}

/**
 * Decrypt the user's sealed profile into a fresh scratch directory and return
 * its path, or null when the user has no sealed profile. The caller owns the
 * returned directory and must wipe it in a `finally`.
 */
export async function unsealProfile(userId: string, ctx: SealContext, opts: UnsealOptions = {}): Promise<string | null> {
  const file = sealedPath(ctx, userId)
  let header: SealHeader
  try {
    header = await readSealHeader(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
  if (header.keyVersion !== SEAL_KEY_VERSION) {
    throw new Error(`sealed blob uses unsupported keyVersion ${header.keyVersion}`)
  }

  const key = deriveKey(ctx.masterKey, userId, header.keyVersion)
  const decipher = createDecipheriv("aes-256-gcm", key, header.iv)
  decipher.setAuthTag(header.tag)

  const dest = await makeScratchDir("jp-profile-", opts.scratchBase)
  const tar = runTar(["-xf", "-", "-C", dest])
  try {
    await Promise.all([
      pipeline(createReadStream(file, { start: SEAL_HEADER_BYTES }), decipher, tar.proc.stdin),
      tar.done,
    ])
    return dest
  } catch {
    tar.proc.kill()
    await wipeDir(dest)
    // Deliberately generic: do not distinguish wrong-key from corruption.
    throw new Error("unseal failed: authentication or archive error")
  }
}

export async function hasSealed(userId: string, ctx: SealContext): Promise<boolean> {
  try {
    await fs.access(sealedPath(ctx, userId))
    return true
  } catch {
    return false
  }
}

/** Remove the user's sealed blob. Returns true if one existed. */
export async function destroySealed(userId: string, ctx: SealContext): Promise<boolean> {
  const file = sealedPath(ctx, userId)
  try {
    await fs.unlink(file)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
}

/** Prefer tmpfs (/dev/shm) when it is writable and has headroom; else os.tmpdir(). */
export function pickScratchBase(): string {
  const shm = "/dev/shm"
  try {
    accessSync(shm, fsConstants.W_OK)
    const st = statfsSync(shm)
    if (Number(st.bavail) * Number(st.bsize) >= SHM_MIN_FREE_BYTES) return shm
  } catch {
    // fall through
  }
  return os.tmpdir()
}

export async function makeScratchDir(prefix: string, base?: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(base ?? pickScratchBase(), prefix))
  await fs.chmod(dir, 0o700)
  return dir
}

/** Best-effort recursive delete; never throws. Called from `finally` blocks. */
export async function wipeDir(dir: string | null | undefined): Promise<void> {
  if (!dir) return
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch {
    // Nothing useful to do; the directory is in tmpfs and dies with the container.
  }
}
