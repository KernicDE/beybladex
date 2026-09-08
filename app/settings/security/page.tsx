// app/settings/security/page.tsx
// Server component: lists the owner's own passkeys and TOTP enrollment status, and renders the
// client panel that drives the EXISTING Task 6 ceremonies (WebAuthn register, TOTP setup/verify)
// plus the new password-reconfirmed /api/totp/disable.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { SecurityPanel } from '@/components/settings/SecurityPanel'

export const dynamic = 'force-dynamic'

export default async function SettingsSecurityPage() {
  const session = await auth()
  const [passkeys, user] = await Promise.all([
    prisma.passkey.findMany({ where: { userId: session!.user!.id }, select: { id: true, credentialId: true } }),
    prisma.user.findUnique({ where: { id: session!.user!.id }, select: { totpSecret: true } }),
  ])
  if (!user) return <p>Benutzerkonto nicht gefunden.</p>

  return (
    <section aria-labelledby="security-heading" className="space-y-6">
      <h2 id="security-heading" className="text-xl font-semibold">Sicherheit</h2>

      <div className="space-y-3">
        <h3 className="font-medium">Passkeys</h3>
        {passkeys.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Noch keine Passkeys registriert. Passkeys sind die bequemste Anmeldemethode.
          </p>
        ) : (
          <ul className="space-y-2">
            {passkeys.map((p) => (
              <li key={p.id} className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
                Passkey <code className="text-xs">{p.credentialId.slice(0, 16)}…</code>
              </li>
            ))}
          </ul>
        )}
        <SecurityPanel passkeyCount={passkeys.length} totpEnabled={!!user.totpSecret} />
      </div>
    </section>
  )
}
