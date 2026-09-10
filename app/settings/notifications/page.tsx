// app/settings/notifications/page.tsx
// Server component: loads the owner's own notification preferences and renders the form that
// PATCHes /api/profile/notifications. Phase 3's radius search (notifyUsersInRadius) and RSS-
// driven discovery consume exactly these fields — without this page they'd be unreachable
// schema columns ([REVIEW-FIX: ux-product §2]). Postal code lives on the Profil tab (it is a
// profile field), so the radius preference here has an obvious companion.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { NotificationsForm } from '@/components/settings/NotificationsForm'
import { PushSubscribeButton } from '@/components/settings/PushSubscribeButton'

export const dynamic = 'force-dynamic'

export default async function SettingsNotificationsPage() {
  const session = await auth()
  const user = await prisma.user.findUnique({
    where: { id: session!.user!.id },
    select: {
      notifyRadiusKm: true, notifyRecurring: true, notifyEmail: true, postalCode: true,
      notifyMatchLifecycle: true, notifyMatchLifecycleEmail: true,
    },
  })
  if (!user) return <p>Benutzerkonto nicht gefunden.</p>

  return (
    <section aria-labelledby="notifications-heading" className="space-y-6">
      <div className="space-y-2">
        <h2 id="notifications-heading" className="text-xl font-semibold">Benachrichtigungen</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Lege fest, über welche Turniere in deiner Umgebung du informiert werden möchtest. Die
          Suche um deinen Wohnort nutzt die Postleitzahl aus deinem{' '}
          <a href="/settings/profile" className="underline">Profil</a>
          {user.postalCode ? '' : ' (noch nicht hinterlegt)'}.
        </p>
      </div>

      {/* Phase 18 item 1 — browser-level opt-in, separate from the per-type preference below
          (a user needs BOTH: OS permission granted here, and notifyMatchLifecycle left on). */}
      <div className="space-y-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-700">
        <h3 className="text-sm font-semibold">Push-Benachrichtigungen (dieses Gerät)</h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Erlaube deinem Browser, dir Turnier- und Match-Ereignisse auch außerhalb eines offenen
          Tabs als System-Benachrichtigung zu zeigen.
        </p>
        <PushSubscribeButton />
      </div>

      <NotificationsForm
        initial={{
          notifyRadiusKm: user.notifyRadiusKm ?? 50,
          notifyRecurring: user.notifyRecurring,
          notifyEmail: user.notifyEmail,
          notifyMatchLifecycle: user.notifyMatchLifecycle,
          notifyMatchLifecycleEmail: user.notifyMatchLifecycleEmail,
        }}
      />
    </section>
  )
}
