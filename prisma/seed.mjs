// prisma/seed.js
// Phase 5 Part A — parts-catalog seed: a starter set of real Beyblade X parts (blades,
// ratchets, bits) and a few legal builds combining them. Idempotent via deterministic ids
// (upsert on id), so re-running never duplicates. Images (imageUrl) are left null until the
// curated /public/parts/ files exist — the UI renders a placeholder for null imageUrl.
// Run: `node prisma/seed.js` (or automatically via `prisma db seed`).
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const BLADES = [
  { id: 'part-blade-dransword-3-60', name: 'DranSword 3-60', beyType: 'ATTACK' },
  { id: 'part-blade-hellsscythe-4-60', name: 'HellsScythe 4-60', beyType: 'BALANCE' },
  { id: 'part-blade-cobaltdragoon-2-60', name: 'CobaltDragoon 2-60', beyType: 'ATTACK' },
  { id: 'part-blade-wizardarrow-4-80', name: 'WizardArrow 4-80', beyType: 'STAMINA' },
  { id: 'part-blade-knightshield-3-80', name: 'KnightShield 3-80', beyType: 'DEFENSE' },
  { id: 'part-blade-sharkedge-3-60', name: 'SharkEdge 3-60', beyType: 'ATTACK' },
  { id: 'part-blade-leonclaw-5-60', name: 'LeonClaw 5-60', beyType: 'ATTACK' },
  { id: 'part-blade-phoenixwing-9-60', name: 'PhoenixWing 9-60', beyType: 'ATTACK' },
  { id: 'part-blade-vipertail-5-80', name: 'ViperTail 5-80', beyType: 'BALANCE' },
  { id: 'part-blade-tyrannobeat-4-60', name: 'TyrannoBeat 4-60', beyType: 'ATTACK' },
]

const RATCHETS = ['3-60', '4-60', '5-60', '3-80', '4-80', '9-60', '2-60', '5-80'].map((name) => ({
  id: `part-ratchet-${name.toLowerCase()}`,
  name,
}))

const BITS = [
  { id: 'part-bit-flat', name: 'Flat' },
  { id: 'part-bit-taper', name: 'Taper' },
  { id: 'part-bit-ball', name: 'Ball' },
  { id: 'part-bit-orb', name: 'Orb' },
  { id: 'part-bit-rush', name: 'Rush' },
  { id: 'part-bit-hex', name: 'Hex' },
  { id: 'part-bit-point', name: 'Point' },
]

async function main() {
  for (const blade of BLADES) {
    await prisma.part.upsert({
      where: { id: blade.id },
      create: { ...blade, manufacturer: 'TT', category: 'BLADE', spinDirection: 'RIGHT' },
      update: {},
    })
  }
  for (const ratchet of RATCHETS) {
    await prisma.part.upsert({
      where: { id: ratchet.id },
      create: { ...ratchet, manufacturer: 'TT', category: 'RATCHET', spinDirection: 'RIGHT' },
      update: {},
    })
  }
  for (const bit of BITS) {
    await prisma.part.upsert({
      where: { id: bit.id },
      create: { ...bit, manufacturer: 'TT', category: 'BIT', spinDirection: 'RIGHT' },
      update: {},
    })
  }

  // A few legal starter builds (each part used at most once per build — trivially true here).
  const COMBOS = [
    { id: 'build-dransword-3-60-flat', bladeId: 'part-blade-dransword-3-60', ratchetId: 'part-ratchet-3-60', bitId: 'part-bit-flat', type: 'ATTACK' },
    { id: 'build-wizardarrow-4-80-orb', bladeId: 'part-blade-wizardarrow-4-80', ratchetId: 'part-ratchet-4-80', bitId: 'part-bit-orb', type: 'STAMINA' },
    { id: 'build-knightshield-3-80-ball', bladeId: 'part-blade-knightshield-3-80', ratchetId: 'part-ratchet-3-80', bitId: 'part-bit-ball', type: 'DEFENSE' },
    { id: 'build-hellsscythe-4-60-taper', bladeId: 'part-blade-hellsscythe-4-60', ratchetId: 'part-ratchet-4-60', bitId: 'part-bit-taper', type: 'BALANCE' },
  ]
  for (const combo of COMBOS) {
    await prisma.build.upsert({ where: { id: combo.id }, create: combo, update: {} })
  }

  const counts = {
    parts: await prisma.part.count(),
    builds: await prisma.build.count(),
  }
  console.log(`Seeded parts catalog: ${counts.parts} parts, ${counts.builds} builds`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
