// app/notifications/page.tsx
// Notification inbox SHELL (Task 13). Phase 3 fills this with the real inbox:
// paginated list from GET /api/notifications, unread-count badge in the Header's
// bell, "alle als gelesen markieren", and live updates via SSE.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { EmptyState } from '@/components/ui/EmptyState'

export default async function NotificationsPage() {
  const session = await auth()

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Benachrichtigungen</h1>
      <EmptyState
        title="Noch keine Benachrichtigungen"
        description="Benachrichtigungen werden in einer späteren Ausbauphase aktiviert."
        action={
          session ? undefined : (
            // Anonymous-vs-member convention (Task 13): a guest sees the same page
            // with an "Anmelden, um fortzufahren" prompt in place of the action.
            <Link
              href="/login"
              className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
            >
              Anmelden, um fortzufahren
            </Link>
          )
        }
      />
    </main>
  )
}
