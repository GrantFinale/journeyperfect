import { getTravelerProfiles } from "@/lib/actions/travelers"
import { getPreferences, getUserTimezone } from "@/lib/actions/preferences"
import { getHomeAddress, getPlacesApiKey } from "@/lib/actions/user"
import { listVehicles } from "@/lib/actions/vehicles"
import { auth } from "@/lib/auth"
import { GlobalSettingsView } from "./global-settings-view"

export default async function SettingsPage() {
  const [session, profiles, prefs, timezone, home, vehicles, placesApiKey] = await Promise.all([
    auth(),
    getTravelerProfiles(),
    getPreferences(),
    getUserTimezone(),
    getHomeAddress(),
    listVehicles(),
    getPlacesApiKey(),
  ])

  return (
    <GlobalSettingsView
      user={session?.user ? { ...session.user, id: session.user.id } : null}
      initialProfiles={profiles.map((p) => ({
        id: p.id,
        name: p.name,
        birthDate: p.birthDate,
        sex: p.sex,
        photoUrl: p.photoUrl,
        tags: p.tags,
        isDefault: p.isDefault,
        preferences: (p.preferences as Record<string, unknown>) ?? null,
      }))}
      initialPrefs={prefs}
      initialTimezone={timezone}
      initialHome={{
        homeAddress: home.homeAddress,
        homeCity: home.homeCity,
        homeLat: home.homeLat,
        homeLng: home.homeLng,
      }}
      initialVehicles={vehicles.map((v) => ({
        id: v.id,
        make: v.make,
        model: v.model,
        year: v.year,
        color: v.color,
        licensePlate: v.licensePlate,
        licensePlateState: v.licensePlateState,
        nickname: v.nickname,
        isDefault: v.isDefault,
      }))}
      placesApiKey={placesApiKey}
    />
  )
}
