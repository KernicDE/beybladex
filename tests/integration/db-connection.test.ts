// tests/integration/db-connection.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'

describe('database connection', () => {
  it('can create and read back a user', async () => {
    const user = await prisma.user.create({ data: { username: `test_${Date.now().toString(36)}` } })
    const found = await prisma.user.findUnique({ where: { id: user.id } })
    expect(found?.username).toBe(user.username)
    await prisma.user.delete({ where: { id: user.id } })
  })
})
