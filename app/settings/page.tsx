// app/settings/page.tsx
// The bare /settings route had no page.tsx — only its sub-tabs (profile, security, privacy,
// notifications, account, admin) did, so it 404'd despite layout.tsx's tab bar implying it's a
// real landing spot (found live on production: https://beybladex.de/settings). Redirect to the
// sensible default tab; the layout's own auth() redirect-to-/login for anonymous visitors still
// applies first (this route renders inside that same layout).
import { redirect } from 'next/navigation'

export default function SettingsIndexPage() {
  redirect('/settings/profile')
}
