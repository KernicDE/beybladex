// app/api/builds/[id]/route.ts (MVP4/4, #144; MVP4/5, #145)
// PATCH — Build bearbeiten (Sichtbarkeit toggeln, Name/Typ setzen). AUTHZ RULE: nur die
// ERSTELLERIN bzw. der Ersteller darf einen Build ändern (Build.creatorId) — 401 anonym,
// 404 für alle anderen inkl. Kuratoren/Admins und Builds ohne Creator (Vor-MVP4-Rows;
// Existenz wird nicht geleakt, standing not-403/not-leak-Privacy-Policy). Builds sind eine
// reine Nutzersache (#139): es gibt KEINEN Admin-/Kuratoren-Schreibweg mehr am Build-Modell
// — der Vor-Split-Pfad /api/admin/builds/[id] wurde mit #145 entfernt (offizielle Sets
// leben seit MVP4/1 im Beyblade-Modell, deren Pflege über /api/admin/builds +
// CatalogProposal-Approval läuft). Ein Build ist niemals geheim: UNLISTED entfernt ihn nur
// aus den öffentlichen Listungen, der Direktlink bleibt.
//   Felder (mindestens eines required): visibility PUBLIC|UNLISTED · name (leer → null →
//   die Anzeige fällt auf den kanonisch abgeleiteten Namen zurück) · type (Bey-Typ; die
//   Spalte ist NOT NULL mit @default(ATTACK) — anders als name gibt es hier keinen
//   „ungesetzt"-Zustand, also muss ein gesendetes type einer der vier Enum-Werte sein).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'

type Ctx = { params: Promise<{ id: string }> }

const NAME_MAX = 160
const TYPES = ['ATTACK', 'DEFENSE', 'STAMINA', 'BALANCE'] as const

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const build = await prisma.build.findUnique({ where: { id }, select: { creatorId: true } })
  if (!build || build.creatorId !== session.user.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) return Response.json({ error: 'invalid_body' }, { status: 400 })
  const b = body as { visibility?: unknown; name?: unknown; type?: unknown }

  // #145 — jeder Patch-Feldwert wird einzeln validiert; mindestens eines muss gesetzt sein.
  const data: Prisma.BuildUpdateInput = {}
  if (b.visibility !== undefined) {
    if (b.visibility !== 'PUBLIC' && b.visibility !== 'UNLISTED') {
      return Response.json({ error: 'invalid_visibility' }, { status: 400 })
    }
    data.visibility = b.visibility
  }
  if (b.name !== undefined) {
    if (typeof b.name !== 'string') return Response.json({ error: 'invalid_name' }, { status: 400 })
    const name = b.name.trim()
    if (name.length > NAME_MAX) return Response.json({ error: 'invalid_name' }, { status: 400 })
    // Leerer Name → null: die Anzeige fällt auf den kanonischen abgeleiteten Namen zurück.
    data.name = name === '' ? null : name
  }
  if (b.type !== undefined) {
    // Build.type ist NOT NULL — anders als name gibt es keinen "leer → abgeleitet"-Zustand.
    if (!(TYPES as readonly unknown[]).includes(b.type)) {
      return Response.json({ error: 'invalid_type' }, { status: 400 })
    }
    data.type = b.type as (typeof TYPES)[number]
  }
  if (Object.keys(data).length === 0) return Response.json({ error: 'empty_patch' }, { status: 400 })

  await prisma.build.update({ where: { id }, data })
  return Response.json({ ok: true, ...data }, { status: 200 })
}

// #161 — DELETE: dieselbe Ersteller-only-Prüfung wie PATCH (404 für alle anderen, kein Leak).
// DeckBuild.buildId ist ON DELETE RESTRICT (steckt der Build noch in einem Deck, schlägt der
// DB-Constraint fehl — Prisma wirft P2003, hier zu 409 build_in_use übersetzt statt eines
// rohen 500). Match.player1/2BuildId ist ON DELETE SET NULL — Turnierhistorie bleibt bestehen,
// verliert nur den Build-Bezug.
export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const build = await prisma.build.findUnique({ where: { id }, select: { creatorId: true } })
  if (!build || build.creatorId !== session.user.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  try {
    await prisma.build.delete({ where: { id } })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return Response.json({ error: 'build_in_use' }, { status: 409 })
    }
    throw err
  }
  return Response.json({ ok: true }, { status: 200 })
}
