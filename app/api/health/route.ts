// app/api/health/route.ts (Phase 6)
// Pure liveness probe for the Docker/Traefik/Watchtower healthcheck and CI boot
// verification. Deliberately does NOT check Postgres/Redis: a health check that
// depends on external services can cause cascading failures (a DB hiccup would
// make Traefik pull the app out of rotation instead of just retrying).
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ status: 'ok' })
}
