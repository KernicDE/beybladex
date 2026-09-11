// app/settings/profile/page.tsx
// Server component: loads the owner's own row (allowed — it's their own data, no privacy gate
// needed for self) and hands it to the client form. A minor's discordTag is hard-hidden from
// every non-owner viewer by resolveVisibleFields regardless of setting, so the form disables
// that field for minors instead of offering a control that silently does nothing.
// RC14 #17 — the page chrome (heading/intro) is translated via the request dictionary; the
// same dictionary is passed to the client ProfileForm as plain props (prop-passing idiom).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getDictionary } from '@/lib/i18n/server'
import { ProfileForm } from '@/components/settings/ProfileForm'
import { AvatarSection } from '@/components/settings/AvatarSection'

export const dynamic = 'force-dynamic' // per-user surface — never cached (Cross-Phase rule)

export default async function SettingsProfilePage() {
  const t = await getDictionary()
  const session = await auth()
  const user = await prisma.user.findUnique({
    where: { id: session!.user!.id },
    select: {
      username: true,
      displayName: true, bio: true, city: true, postalCode: true, state: true, country: true,
      discordTag: true, birthDate: true, isMinor: true, avatarImageId: true, language: true,
    },
  })
  if (!user) return <p>Benutzerkonto nicht gefunden.</p>

  return (
    <section aria-labelledby="profile-heading" className="space-y-4">
      <h2 id="profile-heading" className="text-xl font-semibold">{t.settings.profile.heading}</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {t.settings.profile.intro}
      </p>
      <ProfileForm
        t={t}
        initial={{
          displayName: user.displayName ?? '',
          bio: user.bio ?? '',
          city: user.city ?? '',
          postalCode: user.postalCode ?? '',
          state: user.state ?? '',
          country: user.country,
          discordTag: user.discordTag ?? '',
          birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : '',
          language: user.language,
        }}
        isMinor={user.isMinor}
      />
      {/* Phase 21 (item 3): the avatar manager — preview, upload-on-pick, "Entfernen" only
          while an avatar is set. The viewer's own row: no privacy gate needed. */}
      <AvatarSection username={user.username} avatarImageId={user.avatarImageId} />
    </section>
  )
}
