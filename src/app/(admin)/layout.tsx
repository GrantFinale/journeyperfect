import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import Link from "next/link"
import { Providers } from "@/components/providers"

export const dynamic = "force-dynamic"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user?.isAdmin) redirect("/dashboard")

  return (
    <Providers>
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/admin" className="font-semibold text-gray-900 flex items-center gap-2">
                <img src="/jp-icon.png" alt="JourneyPerfect" className="w-7 h-7" />
                Admin
              </Link>
              <div className="flex gap-4 text-sm">
                <Link href="/admin" className="text-gray-600 hover:text-gray-900">Overview</Link>
                <Link href="/admin/ai" className="text-gray-600 hover:text-gray-900">AI Models</Link>
                <Link href="/admin/plans" className="text-gray-600 hover:text-gray-900">Plans</Link>
                <Link href="/admin/trips" className="text-gray-600 hover:text-gray-900">Trips</Link>
                <Link href="/admin/users" className="text-gray-600 hover:text-gray-900">Users</Link>
                <Link href="/admin/settings" className="text-gray-600 hover:text-gray-900">Settings</Link>
                <Link href="/admin/affiliates" className="text-gray-600 hover:text-gray-900">Affiliates</Link>
              </div>
            </div>
            <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">&larr; Back to app</Link>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </div>
    </Providers>
  )
}
