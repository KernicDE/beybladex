// app/api/tournaments/route.ts
// GET — public list with filters (?country=&state=&lat=&lng=&radiusKm=&q=), paginated take/cursor.
// The radius filter is a bounding-box prefilter in SQL plus an exact haversine pass in JS. This
// inline haversine is a deliberate stopgap: once the parallel geo track's lib/geo.ts lands it can
// be swapped for a shared import — don't duplicate it a third time.
// POST — create a Tournament. AUTHZ RULE (standing Global-Constraints requirement): a session with
// role ORGANIZER or ADMIN is required (401 unauthenticated, 403 otherwise) and createdById is
// ALWAYS taken from the session — the body can never nominate an owner/club. Rate-limited per user.
// TODO(Phase 4): also allow ClubMember.isAdmin for their own club (the master plan's corrected
// authz rule); that path needs Club membership wired up, which is Phase 4's job — until then a
// club admin without the global ORGANIZER role gets 403 here.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { parseTournamentInput } from '@/lib/tournamentValidation'

const PAGE_SIZE = 24
const KM_PER_LAT_DEG = 111.32

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const country = url.searchParams.get('country')
  const state = url.searchParams.get('state')
  const q = (url.searchParams.get('q') ?? '').trim()
  const lat = url.searchParams.get('lat')
  const lng = url.searchParams.get('lng')
  const radiusKm = url.searchParams.get('radiusKm')
  const takeParam = Number(url.searchParams.get('take') ?? PAGE_SIZE)
  const cursor = url.searchParams.get('cursor')

  if (country && !['DE', 'AT', 'CH'].includes(country)) {
    return Response.json({ error: 'invalid_country' }, { status: 400 })
  }
  const take = Number.isInteger(takeParam) && takeParam > 0 && takeParam <= 100 ? takeParam : PAGE_SIZE

  // Radius filter: all three params must be present and numeric, or none.
  const hasRadius = lat !== null || lng !== null || radiusKm !== null
  let center: { lat: number; lng: number; radiusKm: number } | null = null
  if (hasRadius) {
    const latNum = Number(lat)
    const lngNum = Number(lng)
    const radiusNum = Number(radiusKm)
    if (!Number.isFinite(latNum) || Math.abs(latNum) > 90 ||
        !Number.isFinite(lngNum) || Math.abs(lngNum) > 180 ||
        !Number.isFinite(radiusNum) || radiusNum <= 0 || radiusNum > 500) {
      return Response.json({ error: 'invalid_coordinates' }, { status: 400 })
    }
    center = { lat: latNum, lng: lngNum, radiusKm: radiusNum }
  }

  const rows = await prisma.tournament.findMany({
    where: {
      ...(country ? { country: country as 'DE' | 'AT' | 'CH' } : {}),
      ...(state ? { state } : {}),
      ...(q
        ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { city: { contains: q, mode: 'insensitive' } }] }
        : {}),
      ...(center
        ? {
            // Bounding-box prefilter keeps the haversine pass cheap; the exact distance filter
            // runs in JS below (may yield short pages at page boundaries — acceptable at DACH scale).
            latitude: {
              gte: center.lat - center.radiusKm / KM_PER_LAT_DEG,
              lte: center.lat + center.radiusKm / KM_PER_LAT_DEG,
            },
            longitude: {
              gte: center.lng - center.radiusKm / (KM_PER_LAT_DEG * Math.cos((center.lat * Math.PI) / 180)),
              lte: center.lng + center.radiusKm / (KM_PER_LAT_DEG * Math.cos((center.lat * Math.PI) / 180)),
            },
          }
        : {}),
    },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      startDate: true,
      endDate: true,
      city: true,
      state: true,
      country: true,
      latitude: true,
      longitude: true,
      entryFeeCent: true,
      currency: true,
      isRecurring: true,
    },
  })

  const filtered = center
    ? rows.filter((t) => haversineKm(center.lat, center.lng, t.latitude, t.longitude) <= center.radiusKm)
    : rows

  const hasMore = filtered.length > take
  const page = hasMore ? filtered.slice(0, take) : filtered
  const nextCursor = hasMore ? page[page.length - 1].id : null

  return Response.json({ tournaments: page, nextCursor })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`tournaments:create:${session.user.id}`, 20, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  // TODO(Phase 4): also allow ClubMember.isAdmin for their own club (see header comment).
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (!caller || (caller.role !== 'ORGANIZER' && caller.role !== 'ADMIN')) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { data, errors } = parseTournamentInput(body, false)
  if (errors.length > 0) return Response.json({ error: errors[0], errors }, { status: 400 })

  if (data.endDate && data.endDate < data.startDate) {
    return Response.json({ error: 'end_before_start' }, { status: 400 })
  }
  const ruleset = await prisma.ruleset.findUnique({ where: { id: data.rulesetId } })
  if (!ruleset) return Response.json({ error: 'invalid_ruleset' }, { status: 400 })

  const tournament = await prisma.tournament.create({
    // clubId stays null — club-event creation arrives with Phase 4's Club membership model.
    // description is a required (non-null) column; an absent/JSON-null description means "".
    data: { ...data, description: data.description ?? '', clubId: null, createdById: session.user.id },
    select: { id: true, title: true, startDate: true, city: true },
  })

  // TODO(Phase 3 notify track): call notifyUsersInRadius(tournament) once lib/notify.ts lands.
  return Response.json(tournament, { status: 201 })
}
