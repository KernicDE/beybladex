// app/(auth)/login/page.tsx
// RC14-Nachzügler #130 — server component: resolves the request dictionary and hands the
// translated strings to the client form (components/auth/LoginForm.tsx, prop-passing idiom).
import { getDictionary } from '@/lib/i18n/server'
import { LoginForm } from '@/components/auth/LoginForm'

export default async function LoginPage() {
  const t = await getDictionary()
  return <LoginForm t={t.auth.login} />
}
