// app/(auth)/register/page.tsx
// RC14-Nachzügler #130 — server component: resolves the request dictionary and hands the
// translated strings to the client form (components/auth/RegisterForm.tsx, prop-passing idiom).
import { getDictionary } from '@/lib/i18n/server'
import { RegisterForm } from '@/components/auth/RegisterForm'

export default async function RegisterPage() {
  const t = await getDictionary()
  return <RegisterForm t={t.auth.register} />
}
