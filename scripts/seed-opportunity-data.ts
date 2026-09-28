/**
 * Seed the Opportunity Discovery Engine reference tables.
 *
 *   npx tsx scripts/seed-opportunity-data.ts
 *
 * Upserts:
 *   - src/data/nonstop-routes.json        -> prisma.nonstopRoute       (unique [originIata, destIata])
 *   - src/data/destination-profiles.json  -> prisma.destinationProfile (unique iata)
 *
 * Idempotent: re-running refreshes every row and bumps lastVerifiedAt / refreshedAt.
 * Requires DATABASE_URL and a generated Prisma client that includes the section-7
 * models from docs/plans/opportunity-discovery-engine.md.
 *
 * Provenance of the input files is documented in src/data/README.md.
 */

import fs from "node:fs"
import path from "node:path"
import { prisma } from "../src/lib/db"

// Resolved from the repo root (run this script from there). Avoids import.meta /
// __dirname differences between tsx's ESM and CJS modes.
const DATA_DIR = path.resolve(process.cwd(), "src", "data")
if (!fs.existsSync(path.join(DATA_DIR, "nonstop-routes.json"))) {
  throw new Error(`Expected ${DATA_DIR}/nonstop-routes.json - run from the repo root: npx tsx scripts/seed-opportunity-data.ts`)
}

interface NonstopRouteSeed {
  originIata: string
  destIata: string
  carriers: string[]
  typicalDurationMins: number
}

interface DestinationProfileSeed {
  iata: string
  name: string
  lat: number
  lng: number
  tier: "BUDGET" | "MID" | "UPSCALE" | "LUXURY"
  idealNightsMin: number
  idealNightsMax: number
  walkable: boolean
  carNeeded: boolean
  airportToCenterKm: number
  parkingTypical: "FREE" | "CHEAP" | "EXPENSIVE"
  activitiesDispersed: boolean
  familyFit: {
    tags: string[]
    byAgeBand: Record<"0-5" | "6-12" | "13-17" | "adult", number>
    indoorRatio: number
  }
  anchors: Array<{
    title: string
    kind: "THEME_PARK" | "EVENT" | "NATURE" | "ATTRACTION" | "SPORTS" | "FESTIVAL"
    months: number[]
    weatherDependent: boolean
  }>
  climate: { monthly: Array<{ m: number; highF: number; lowF: number; precipDays: number }> } | null
  generatedBy: string
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")) as T
}

const ROUTE_BATCH = 500

/**
 * Upsert semantics for routes:
 *   - missing pair                     -> insert as OPENFLIGHTS_SEED
 *   - existing pair, source == seed    -> refresh carriers / duration / lastVerifiedAt
 *   - existing pair, any other source  -> leave untouched (OBSERVED_OFFER / SCHEDULE_API
 *                                         are fresher than a 2014 dataset)
 */
async function seedNonstopRoutes(now: Date) {
  const routes = readJson<NonstopRouteSeed[]>("nonstop-routes.json")
  console.log(`Seeding ${routes.length} nonstop routes ...`)

  const existing = await prisma.nonstopRoute.findMany({
    select: { originIata: true, destIata: true, source: true },
  })
  const existingByKey = new Map(existing.map((r) => [`${r.originIata}-${r.destIata}`, r.source]))

  const toCreate: NonstopRouteSeed[] = []
  const toRefresh: NonstopRouteSeed[] = []
  let skipped = 0
  for (const r of routes) {
    const source = existingByKey.get(`${r.originIata}-${r.destIata}`)
    if (source === undefined) toCreate.push(r)
    else if (source === "OPENFLIGHTS_SEED") toRefresh.push(r)
    else skipped++
  }

  for (let i = 0; i < toCreate.length; i += ROUTE_BATCH) {
    await prisma.nonstopRoute.createMany({
      data: toCreate.slice(i, i + ROUTE_BATCH).map((r) => ({
        originIata: r.originIata,
        destIata: r.destIata,
        carriers: r.carriers,
        weeklyFrequency: null,
        typicalDurationMins: r.typicalDurationMins,
        departureBuckets: [],
        source: "OPENFLIGHTS_SEED",
        lastVerifiedAt: now,
      })),
      skipDuplicates: true,
    })
  }

  for (let i = 0; i < toRefresh.length; i += ROUTE_BATCH) {
    await prisma.$transaction(
      toRefresh.slice(i, i + ROUTE_BATCH).map((r) =>
        prisma.nonstopRoute.update({
          where: { originIata_destIata: { originIata: r.originIata, destIata: r.destIata } },
          data: { carriers: r.carriers, typicalDurationMins: r.typicalDurationMins, lastVerifiedAt: now },
        }),
      ),
    )
  }

  console.log(
    `  nonstop routes: ${toCreate.length} created, ${toRefresh.length} refreshed, ${skipped} skipped (owned by a fresher source)`,
  )
}

async function seedDestinationProfiles(now: Date) {
  const profiles = readJson<DestinationProfileSeed[]>("destination-profiles.json")
  console.log(`Seeding ${profiles.length} destination profiles ...`)

  for (const p of profiles) {
    const data = {
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      tier: p.tier,
      idealNightsMin: p.idealNightsMin,
      idealNightsMax: p.idealNightsMax,
      walkable: p.walkable,
      carNeeded: p.carNeeded,
      airportToCenterKm: p.airportToCenterKm,
      parkingTypical: p.parkingTypical,
      activitiesDispersed: p.activitiesDispersed,
      familyFit: p.familyFit,
      anchors: p.anchors,
      climate: p.climate ?? undefined,
      generatedBy: p.generatedBy,
      refreshedAt: now,
    }
    await prisma.destinationProfile.upsert({
      where: { iata: p.iata },
      create: { iata: p.iata, ...data },
      update: data,
    })
  }
  console.log(`  destination profiles: ${profiles.length} upserted`)
}

async function main() {
  const now = new Date()
  await seedNonstopRoutes(now)
  await seedDestinationProfiles(now)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
