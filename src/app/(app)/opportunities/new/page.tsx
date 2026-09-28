import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { hasFeature } from "@/lib/features"
import { getAge } from "@/lib/utils"
import { getHomeAirports } from "@/lib/actions/opportunities"
import { NewSearchForm, type HomeAirport, type TravelerOption } from "./new-search-form"

export const dynamic = "force-dynamic"

export default async function NewOpportunitySearchPage() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) redirect("/login")

  const [user, profiles, airportsResult] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
    prisma.travelerProfile.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true, birthDate: true, isDefault: true },
    }),
    getHomeAirports().catch(() => [] as HomeAirport[]),
  ])

  if (!hasFeature(user?.plan || "FREE", "opportunityDiscovery")) redirect("/opportunities")

  const travelers: TravelerOption[] = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    age: p.birthDate ? getAge(p.birthDate) : null,
    isDefault: p.isDefault,
  }))

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <Link
        href="/opportunities"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Opportunities
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">New search</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          When are you free, how long would you go, and who&apos;s coming?
        </p>
      </div>
      <NewSearchForm homeAirports={airportsResult} travelers={travelers} />
    </div>
  )
}
