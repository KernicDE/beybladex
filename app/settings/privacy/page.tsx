// app/settings/privacy/page.tsx
// Server component: fetches the owner's own visibility settings + isMinor, renders the form
// that PATCHes the EXISTING /api/profile/privacy route (Task 7). For minors, the
// locationVisibility control is locked: resolveVisibleFields hard-caps a minor's city for
// every non-owner viewer regardless of this setting, so the UI must not offer a control that
// silently does nothing.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { PrivacyForm } from '@/components/settings/PrivacyForm'

export const dynamic = 'force-dynamic'

export default async function SettingsPrivacyPage() {
  const session = await auth()
  const user = await prisma.user.findUnique({
    where: { id: session!.user!.id },
    select: {
      profileVisibility: true, locationVisibility: true, collectionVisibility: true,
      decksVisibility: true, ageVisibility: true, isMinor: true,
    },
  })
  if (!user) return <p>Benutzerkonto nicht gefunden.</p>

  return (
    <section aria-labelledby="privacy-heading" className="space-y-4">
      <h2 id="privacy-heading" className="text-xl font-semibold">Privatsphäre</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Lege fest, wer deine Profilangaben, deinen Wohnort, deine Sammlung und deine Decks sehen
        kann. Für Minderjährige gelten zusätzliche, nicht überschreibbare Grenzen.
      </p>
      <PrivacyForm
        initial={{
          profileVisibility: user.profileVisibility,
          locationVisibility: user.locationVisibility,
          collectionVisibility: user.collectionVisibility,
          decksVisibility: user.decksVisibility,
          ageVisibility: user.ageVisibility,
        }}
        isMinor={user.isMinor}
      />
    </section>
  )
}
