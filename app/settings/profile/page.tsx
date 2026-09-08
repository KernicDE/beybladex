// app/settings/profile/page.tsx
// Server component: loads the owner's own row (allowed — it's their own data, no privacy gate
// needed for self) and hands it to the client form. A minor's discordTag is hard-hidden from
// every non-owner viewer by resolveVisibleFields regardless of setting, so the form disables
// that field for minors instead of offering a control that silently does nothing.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { ProfileForm } from '@/components/settings/ProfileForm'

export const dynamic = 'force-dynamic' // per-user surface — never cached (Cross-Phase rule)

export default async function SettingsProfilePage() {
  const session = await auth()
  const user = await prisma.user.findUnique({
    where: { id: session!.user!.id },
    select: {
      displayName: true, bio: true, city: true, postalCode: true, state: true, country: true,
      discordTag: true, birthDate: true, isMinor: true,
    },
  })
  if (!user) return <p>Benutzerkonto nicht gefunden.</p>

  return (
    <section aria-labelledby="profile-heading" className="space-y-4">
      <h2 id="profile-heading" className="text-xl font-semibold">Profil bearbeiten</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Hier kannst du deine Profilangaben ändern (Art. 16 DSGVO). Dein Benutzername ist deine
        Plattform-Identität und kann nicht geändert werden.
      </p>
      <ProfileForm
        initial={{
          displayName: user.displayName ?? '',
          bio: user.bio ?? '',
          city: user.city ?? '',
          postalCode: user.postalCode ?? '',
          state: user.state ?? '',
          country: user.country,
          discordTag: user.discordTag ?? '',
          birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : '',
        }}
        isMinor={user.isMinor}
      />
    </section>
  )
}
