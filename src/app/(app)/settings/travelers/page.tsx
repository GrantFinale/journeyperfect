import { getTravelerProfiles } from "@/lib/actions/travelers"
import { TravelerPreferences } from "./traveler-preferences"

export default async function TravelerProfilesPage() {
  const profiles = await getTravelerProfiles()

  return (
    <TravelerPreferences
      initialProfiles={profiles.map((p) => ({
        id: p.id,
        name: p.name,
        birthDate: p.birthDate,
        tags: p.tags,
        isDefault: p.isDefault,
        preferences: (p.preferences as Record<string, unknown>) ?? null,
      }))}
    />
  )
}
