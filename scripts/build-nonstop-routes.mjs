#!/usr/bin/env node
/**
 * Build src/data/nonstop-routes.json from the OpenFlights routes + airports datasets.
 *
 * Filters OpenFlights routes to:
 *   - stops == 0
 *   - origin airport in the United States
 *   - destination airport in the United States, Canada, Mexico, or the Caribbean
 *   - both endpoints have a valid IATA code
 *
 * and aggregates them by (originIata, destIata), collecting the unique set of
 * IATA airline codes and estimating a typical block time from the great-circle
 * distance (800 km/h cruise + 40 min taxi/climb/descent overhead).
 *
 * Usage:
 *   node scripts/build-nonstop-routes.mjs [--data-dir <dir>] [--out <file>]
 *
 * The data dir must contain routes.dat and airports.dat, e.g. downloaded with:
 *   curl -sSL -o routes.dat   https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat
 *   curl -sSL -o airports.dat https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat
 *
 * If --data-dir is omitted the script downloads both files into a temp dir.
 * If --out is omitted it writes to src/data/nonstop-routes.json relative to the repo root.
 *
 * Note: OpenFlights routes data was last refreshed in 2014. It is a stale but
 * usable first cut for candidate generation; the NonstopRoute table self-corrects
 * via OBSERVED_OFFER upserts (see docs/plans/opportunity-discovery-engine.md §7).
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, "..")

const ROUTES_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat"
const AIRPORTS_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat"

const ORIGIN_COUNTRIES = new Set(["United States"])

// Destination countries: US, Canada, Mexico, and the Caribbean (as OpenFlights spells them).
// Puerto Rico and the US Virgin Islands are separate "countries" in OpenFlights.
const DEST_COUNTRIES = new Set([
  "United States",
  "Canada",
  "Mexico",
  // Caribbean
  "Anguilla",
  "Antigua and Barbuda",
  "Aruba",
  "Bahamas",
  "Barbados",
  "Bermuda", // Atlantic, not strictly Caribbean, but a standard US leisure nonstop market
  "Bonaire, Saint Eustatius and Saba",
  "British Virgin Islands",
  "Cayman Islands",
  "Cuba",
  "Curacao",
  "Dominica",
  "Dominican Republic",
  "Grenada",
  "Guadeloupe",
  "Haiti",
  "Jamaica",
  "Martinique",
  "Montserrat",
  "Netherlands Antilles",
  "Puerto Rico",
  "Saint Barthelemy",
  "Saint Kitts and Nevis",
  "Saint Lucia",
  "Saint Martin",
  "Saint Vincent and the Grenadines",
  "Sint Maarten",
  "Trinidad and Tobago",
  "Turks and Caicos Islands",
  "Virgin Islands",
])

const CRUISE_KMH = 800
const OVERHEAD_MINS = 40

function parseArgs(argv) {
  const args = { dataDir: null, out: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--data-dir") args.dataDir = argv[++i]
    else if (argv[i] === "--out") args.out = argv[++i]
  }
  return args
}

/** Minimal CSV line parser that honours double-quoted fields (OpenFlights style). */
function parseCsvLine(line) {
  const out = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function isValidIata(code) {
  return typeof code === "string" && /^[A-Z0-9]{3}$/.test(code) && code !== "\\N"
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function estimateDurationMins(km) {
  return Math.round((km / CRUISE_KMH) * 60 + OVERHEAD_MINS)
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  let dataDir = args.dataDir
  if (!dataDir) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openflights-"))
    console.error(`Downloading OpenFlights data into ${dataDir} ...`)
    await Promise.all([
      download(ROUTES_URL, path.join(dataDir, "routes.dat")),
      download(AIRPORTS_URL, path.join(dataDir, "airports.dat")),
    ])
  }

  const outPath = args.out ?? path.join(REPO_ROOT, "src", "data", "nonstop-routes.json")

  // ── airports.dat ──────────────────────────────────────────────────────────
  // Columns: id, name, city, country, iata, icao, lat, lng, alt, tz offset, dst, tz name, type, source
  const airportsById = new Map()
  const airportsByIata = new Map()
  const airportLines = fs.readFileSync(path.join(dataDir, "airports.dat"), "utf8").split(/\r?\n/)
  for (const line of airportLines) {
    if (!line.trim()) continue
    const f = parseCsvLine(line)
    if (f.length < 8) continue
    const rec = {
      id: f[0],
      name: f[1],
      city: f[2],
      country: f[3],
      iata: f[4],
      lat: Number(f[6]),
      lng: Number(f[7]),
    }
    if (!Number.isFinite(rec.lat) || !Number.isFinite(rec.lng)) continue
    airportsById.set(rec.id, rec)
    if (isValidIata(rec.iata) && !airportsByIata.has(rec.iata)) airportsByIata.set(rec.iata, rec)
  }

  // ── routes.dat ────────────────────────────────────────────────────────────
  // Columns: airline, airline id, source iata, source id, dest iata, dest id, codeshare, stops, equipment
  const routeLines = fs.readFileSync(path.join(dataDir, "routes.dat"), "utf8").split(/\r?\n/)
  const agg = new Map() // key "ORG-DST" -> { originIata, destIata, carriers:Set, km }
  let scanned = 0
  let kept = 0

  for (const line of routeLines) {
    if (!line.trim()) continue
    const f = parseCsvLine(line)
    if (f.length < 8) continue
    scanned++
    const [airline, , srcIata, srcId, dstIata, dstId, , stops] = f
    if (stops !== "0") continue
    if (!isValidIata(srcIata) || !isValidIata(dstIata)) continue
    if (srcIata === dstIata) continue

    const src = airportsById.get(srcId) ?? airportsByIata.get(srcIata)
    const dst = airportsById.get(dstId) ?? airportsByIata.get(dstIata)
    if (!src || !dst) continue
    if (!ORIGIN_COUNTRIES.has(src.country)) continue
    if (!DEST_COUNTRIES.has(dst.country)) continue

    const key = `${srcIata}-${dstIata}`
    let entry = agg.get(key)
    if (!entry) {
      entry = {
        originIata: srcIata,
        destIata: dstIata,
        carriers: new Set(),
        km: haversineKm(src.lat, src.lng, dst.lat, dst.lng),
      }
      agg.set(key, entry)
    }
    if (airline && airline !== "\\N") entry.carriers.add(airline)
    kept++
  }

  const routes = [...agg.values()]
    .map((e) => ({
      originIata: e.originIata,
      destIata: e.destIata,
      carriers: [...e.carriers].sort(),
      typicalDurationMins: estimateDurationMins(e.km),
    }))
    .sort((a, b) =>
      a.originIata === b.originIata
        ? a.destIata.localeCompare(b.destIata)
        : a.originIata.localeCompare(b.originIata),
    )

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  // One record per line: compact, but still diff-friendly.
  const body = routes.map((r) => JSON.stringify(r)).join(",\n")
  fs.writeFileSync(outPath, `[\n${body}\n]\n`)

  const origins = new Set(routes.map((r) => r.originIata)).size
  const dests = new Set(routes.map((r) => r.destIata)).size
  console.error(
    `Scanned ${scanned} route rows, matched ${kept}, aggregated to ${routes.length} nonstop pairs ` +
      `(${origins} US origins, ${dests} destinations). Wrote ${path.relative(process.cwd(), outPath)}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
