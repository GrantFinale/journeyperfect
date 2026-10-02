#!/usr/bin/env node
// Writes solid-colour 16/48/128 PNG icons to ../icons. No dependencies.
// Usage: node extensions/go-rates/tools/make-icons.js
"use strict"
const fs = require("node:fs")
const path = require("node:path")
const zlib = require("node:zlib")

const COLOR = [0x1d, 0x4e, 0xd8] // JourneyPerfect blue

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const row = Buffer.alloc(1 + size * 3)
  for (let x = 0; x < size; x++) row.set(COLOR, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

const dir = path.join(__dirname, "..", "icons")
fs.mkdirSync(dir, { recursive: true })
for (const s of [16, 48, 128]) fs.writeFileSync(path.join(dir, `icon${s}.png`), png(s))
console.log("wrote", dir)
