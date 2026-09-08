// app/settings/layout.tsx
// Owner-only shell (Task 12): no session → straight to /login. Every settings tab renders
// inside this layout; the tab bar itself is a client component (active-state via usePathname).
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { SettingsTabs } from '@/components/settings/SettingsTabs'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-x-cyan-text dark:text-x-cyan">Einstellungen</h1>
      <SettingsTabs />
      <div className="mt-6">{children}</div>
    </main>
  )
}
