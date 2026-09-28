import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { hasFeature } from "@/lib/features"
import { getOpportunitySearch } from "@/lib/actions/opportunities"
import { SearchView } from "./search-view"

export const dynamic = "force-dynamic"

export default async function OpportunitySearchPage({ params }: { params: Promise<{ searchId: string }> }) {
  const { searchId } = await params
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) redirect("/login")

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
  if (!hasFeature(user?.plan || "FREE", "opportunityDiscovery")) redirect("/opportunities")

  const data = await getOpportunitySearch(searchId)
  if (!data) notFound()

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <Link
        href="/opportunities"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Opportunities
      </Link>
      <SearchView search={data.search} opportunities={data.opportunities} candidateCounts={data.candidateCounts} />
    </div>
  )
}
