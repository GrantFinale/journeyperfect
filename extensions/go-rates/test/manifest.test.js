"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.join(__dirname, "..")
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"))

test("manifest is MV3 with the exact permissions and host permissions", () => {
  assert.equal(manifest.manifest_version, 3)
  assert.deepEqual(manifest.permissions, ["tabs", "storage"])
  assert.deepEqual(manifest.host_permissions, [
    "https://www.hilton.com/*",
    "https://www.marriott.com/*",
    "https://journeyperfect.com/*",
    "https://www.journeyperfect.com/*",
    "http://localhost:3000/*",
  ])
  assert.equal(manifest.content_security_policy, undefined, "default CSP")
})

test("every file referenced by the manifest exists", () => {
  const files = new Set([manifest.background.service_worker, manifest.action.default_popup])
  for (const p of Object.values(manifest.icons)) files.add(p)
  for (const p of Object.values(manifest.action.default_icon)) files.add(p)
  for (const cs of manifest.content_scripts) for (const js of cs.js) files.add(js)
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), `missing ${f}`)
})

test("files loaded by pages and the worker exist and pull no remote code", () => {
  const popup = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8")
  for (const m of popup.matchAll(/src="([^"]+)"/g)) {
    assert.doesNotMatch(m[1], /^(https?:)?\/\//, "no remote scripts")
    assert.ok(fs.existsSync(path.join(ROOT, m[1])), `missing ${m[1]}`)
  }
  const bg = fs.readFileSync(path.join(ROOT, "background.js"), "utf8")
  for (const m of bg.matchAll(/importScripts\("([^"]+)"\)/g)) assert.ok(fs.existsSync(path.join(ROOT, m[1])), `missing ${m[1]}`)
  for (const f of ["background.js", "popup.js", "content/hilton.js", "content/marriott.js", "content/journeyperfect.js", "lib/extract.js", "lib/plan.js"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8")
    assert.doesNotMatch(src, /\beval\s*\(|new Function\s*\(|document\.cookie|chrome\.cookies/, f)
  }
})

test("content script matches line up with the contract", () => {
  const [jp, hilton, marriott] = manifest.content_scripts
  assert.equal(manifest.content_scripts.length, 3)
  assert.equal(manifest.version, "0.3.0")
  assert.deepEqual(jp.matches, ["https://journeyperfect.com/*", "https://www.journeyperfect.com/*", "http://localhost:3000/*"])
  assert.equal(jp.run_at, "document_start")
  assert.deepEqual(hilton.matches, ["https://www.hilton.com/*"])
  assert.equal(hilton.run_at, "document_idle")
  assert.deepEqual(hilton.js, ["lib/extract.js", "content/hilton.js"])
  assert.deepEqual(marriott.matches, ["https://www.marriott.com/*"])
  assert.equal(marriott.run_at, "document_idle")
  assert.deepEqual(marriott.js, ["lib/extract.js", "content/marriott.js"])
})

test("site content scripts share one lifecycle and differ only in their brand", () => {
  const h = fs.readFileSync(path.join(ROOT, "content/hilton.js"), "utf8")
  const m = fs.readFileSync(path.join(ROOT, "content/marriott.js"), "utf8")
  assert.match(h, /const BRAND = "hilton"/)
  assert.match(m, /const BRAND = "marriott"/)
  const body = (src) => src.slice(src.indexOf(";(function"))
  assert.equal(body(m).replace('"marriott"', '"hilton"'), body(h))
})
