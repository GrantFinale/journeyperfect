import { getTravelerProfiles } from "@/lib/actions/travelers"
import { getPreferences } from "@/lib/actions/preferences"
import { auth } from "@/lib/auth"
import { GlobalSettingsView } from "./global-settings-view"

export default async function SettingsPage() {
  const [session, profiles, prefs] = await Promise.all([
    auth(),
    getTravelerProfiles(),
    getPreferences(),
  ])

  return (
    <GlobalSettingsView
      user={session?.user ? { ...session.user, id: session.user.id } : null}
      initialProfiles={profiles}
      initialPrefs={prefs}
    />
  )
}
