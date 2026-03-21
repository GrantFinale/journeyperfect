import { getTravelerProfiles } from "@/lib/actions/travelers"
import { getPreferences, getUserTimezone } from "@/lib/actions/preferences"
import { auth } from "@/lib/auth"
import { GlobalSettingsView } from "./global-settings-view"

export default async function SettingsPage() {
  const [session, profiles, prefs, timezone] = await Promise.all([
    auth(),
    getTravelerProfiles(),
    getPreferences(),
    getUserTimezone(),
  ])

  return (
    <GlobalSettingsView
      user={session?.user ? { ...session.user, id: session.user.id } : null}
      initialProfiles={profiles}
      initialPrefs={prefs}
      initialTimezone={timezone}
    />
  )
}
