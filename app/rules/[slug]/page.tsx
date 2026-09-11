// app/rules/[slug]/page.tsx
// Public ruleset view. Anonymous-readable when isPublic = true. A private ruleset returns
// notFound() (404, NOT 403) for everyone except its owner — existence is never leaked.
// revalidate = 300 per the standing public-surface convention; the auth() call for the
// owner-only edit affordance renders the page effectively dynamic, the directive pins the
// caching intent for the public surface.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import { DECK_FORMAT_LABELS } from '@/lib/rulesetLabels'
import { buildRulesetProse } from '@/lib/rulesetProse'
import { isWobStandard } from '@/lib/wobBase'
import { RulesetToggleChecklist } from '@/components/rules/RulesetToggleChecklist'

export const revalidate = 300 // [REVIEW-FIX: performance P16]

export default async function RulesetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await auth()

  const ruleset = await prisma.ruleset.findUnique({
    where: { slug },
    include: { createdBy: { select: { username: true } } },
  })
  if (!ruleset) notFound()
  if (!ruleset.isPublic && ruleset.createdById !== session?.user?.id) notFound()

  const isOwner = ruleset.createdById === session?.user?.id
  // Phase 10 item 3 — full explanatory paragraphs per toggle, modeled on the WBO rules page's
  // depth, instead of a bare badge + one-line hint.
  // RC10 #72: prose is now SECONDARY (behind "Erklärung anzeigen" in the checklist); the
  // primary rendering is the compact ✓/✗ list with per-option WoB deviation marks.
  const toggleProse = buildRulesetProse(ruleset)
  const wobStandard = isWobStandard(ruleset)

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{ruleset.title}</h1>
        <Badge tone="cyan">{DECK_FORMAT_LABELS[ruleset.deckFormat]}</Badge>
        {wobStandard && <Badge tone="green">WoB-Standard</Badge>}
        {!ruleset.isPublic && <Badge tone="neutral">Privat</Badge>}
      </div>

      {ruleset.description && <MarkdownContent className="text-current/80">{ruleset.description}</MarkdownContent>}

      <dl className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <dt className="text-sm text-current/60">Zielpunkte (Vorrunde)</dt>
          <dd className="text-xl font-semibold">{ruleset.targetPoints}</dd>
        </Card>
        <Card className="p-4">
          <dt className="text-sm text-current/60">Zielpunkte (Finale)</dt>
          <dd className="text-xl font-semibold">{ruleset.finalsTargetPoints}</dd>
        </Card>
        <Card className="p-4">
          <dt className="text-sm text-current/60">Relaunch-Limit</dt>
          <dd className="text-xl font-semibold">{ruleset.relaunchLimit}</dd>
        </Card>
      </dl>

      <Card>
        <h2 className="text-lg font-semibold">Sonderregeln</h2>
        <p className="mt-1 text-sm text-current/60">
          Dieses Regelwerk basiert auf dem WoB-Standard (World Beyblade Organization).
          Abweichungen von diesem Standard sind pro Regel gekennzeichnet; die ausführliche
          Erklärung steht hinter „Erklärung anzeigen“.
        </p>
        <div className="mt-3">
          <RulesetToggleChecklist items={toggleProse} />
        </div>
      </Card>

      <p className="text-sm text-current/60">
        Erstellt von {ruleset.createdBy.username}
      </p>

      <div className="flex flex-wrap gap-3">
        <a
          href={`/rules/${ruleset.slug}/pdf`}
          className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
        >
          Als PDF herunterladen
        </a>
        {isOwner && (
          <Link
            href={`/rules/${ruleset.slug}/edit`}
            className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
          >
            Bearbeiten
          </Link>
        )}
      </div>
    </main>
  )
}
