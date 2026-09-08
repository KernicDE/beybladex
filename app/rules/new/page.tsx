// app/rules/new/page.tsx
// Create entry for the ruleset editor — auth required (Global Constraints: creating is a
// session-bound action); guests are sent to login.
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { RulesetForm } from '@/components/rules/RulesetForm'

export const dynamic = 'force-dynamic' // per-user surface — never cached (Cross-Phase rule)

export default async function NewRulesetPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Neues Regelwerk</h1>
      <RulesetForm mode="create" />
    </main>
  )
}
