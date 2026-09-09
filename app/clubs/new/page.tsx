// app/clubs/new/page.tsx
// Club-creation entry — auth required (creating is a session-bound action); guests → login.
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { ClubForm } from '@/components/clubs/ClubForm'

export const dynamic = 'force-dynamic' // per-user surface — never cached (Cross-Phase rule)

export default async function NewClubPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Neuer Club</h1>
      <p className="text-sm text-current/60">
        Du wirst automatisch Besitzer:in und Administrator:in des neuen Clubs.
      </p>
      <ClubForm />
    </main>
  )
}
