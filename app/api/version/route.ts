// app/api/version/route.ts (issue #77)
// Public version endpoint — the machine-readable counterpart of the version string in
// the footer. Deliberately unauthenticated: the version is not sensitive (it is shown
// to every visitor) and support/bugreport workflows need it without a session.
import { APP_VERSION, VERSION_COMMIT, VERSION_DATE } from '@/lib/version'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ version: APP_VERSION, date: VERSION_DATE, commit: VERSION_COMMIT })
}
