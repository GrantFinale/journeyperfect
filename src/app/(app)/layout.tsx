import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { AppShell } from "@/components/app-shell"
import { Providers } from "@/components/providers"
import { ReferralCapture } from "@/components/referral-capture"

// Force dynamic so this layout never gets statically prerendered
export const dynamic = "force-dynamic"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <Providers>
      <ReferralCapture />
      <AppShell user={session.user}>{children}</AppShell>
    </Providers>
  )
}
