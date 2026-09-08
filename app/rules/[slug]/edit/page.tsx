// app/rules/[slug]/edit/page.tsx
// Owner-only editor. Non-owners (and anonymous visitors) are redirected to the view page,
// which itself 404s for private rulesets it doesn't own — no existence leak, no edit affordance.
import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { RulesetForm } from '@/components/rules/RulesetForm'

export const dynamic = 'force-dynamic' // per-user surface — never cached (Cross-Phase rule)

export default async function EditRulesetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const ruleset = await prisma.ruleset.findUnique({ where: { slug } })
  if (!ruleset) notFound()
  if (ruleset.createdById !== session.user.id) redirect(`/rules/${slug}`)

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Regelwerk bearbeiten</h1>
      <RulesetForm
        mode="edit"
        slug={ruleset.slug}
        initial={{
          title: ruleset.title,
          description: ruleset.description ?? '',
          isPublic: ruleset.isPublic,
          deckFormat: ruleset.deckFormat,
          targetPoints: String(ruleset.targetPoints),
          finalsTargetPoints: String(ruleset.finalsTargetPoints),
          lockedDecks: ruleset.lockedDecks,
          allowForceSwitch: ruleset.allowForceSwitch,
          arenaTurnAllowed: ruleset.arenaTurnAllowed,
          outOfBounds2Pts: ruleset.outOfBounds2Pts,
          ownFinishPenalty: ruleset.ownFinishPenalty,
          relaunchLimit: String(ruleset.relaunchLimit),
          aerialContactRerun: ruleset.aerialContactRerun,
          externalDisturbanceRerun: ruleset.externalDisturbanceRerun,
        }}
      />
    </main>
  )
}
