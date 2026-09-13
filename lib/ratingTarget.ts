// lib/ratingTarget.ts (MVP4, #139/#141)
// Integritäts-Helper für das polymorphe Rating: Rating.targetId trägt bewusst KEINE FK
// (Begründung am Prisma-Enum RatingTargetType — ein Rating soll das Löschen seines Ziels
// nicht blockieren). Stattdessen verifiziert diese Lib beim Schreiben, dass das Ziel
// EXISTIERT — ein Rating auf ein bereits gelöschtes Ziel wird 404 statt stiller Leiche.
import type { RatingTargetType } from '@prisma/client'

// Minimaler Prisma-Seam — derselbe Stil wie lib/assembly.ts verifyAssemblyParts, damit die
// Route gegen echtes Prisma läuft und Unit-Tests gegen einen Fake.
type RatingTargetDb = {
  beyblade: { findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null> }
  build: { findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null> }
  part: { findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null> }
}

const TARGET_MODEL: Record<RatingTargetType, keyof RatingTargetDb> = {
  BEYBLADE: 'beyblade',
  BUILD: 'build',
  PART: 'part',
}

/** true, wenn das polymorphe Rating-Ziel existiert. */
export async function ratingTargetExists(prisma: RatingTargetDb, targetType: RatingTargetType, targetId: string): Promise<boolean> {
  const row = await prisma[TARGET_MODEL[targetType]].findUnique({ where: { id: targetId }, select: { id: true } })
  return row !== null
}
