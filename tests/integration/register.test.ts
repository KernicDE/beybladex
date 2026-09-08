// tests/integration/register.test.ts
import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/register/route'
import { prisma } from '@/lib/db'

describe('POST /api/register', () => {
  it('creates a user with only username+password, no email required, no Set-Cookie on the request path before login', async () => {
    const username = `newuser_${Date.now()}`
    const req = new Request('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'correct horse battery staple', birthDate: '1990-01-01', privacyPolicyAccepted: true }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const user = await prisma.user.findUnique({ where: { username } })
    expect(user).not.toBeNull()
    expect(user!.email).toBeNull()
    await prisma.user.delete({ where: { username } })
  })

  it('rejects a duplicate username', async () => {
    const username = `dupuser_${Date.now()}`
    await prisma.user.create({ data: { username, passwordHash: 'x' } })
    const req = new Request('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'whatever12345', birthDate: '1990-01-01', privacyPolicyAccepted: true }),
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    await prisma.user.delete({ where: { username } })
  })
})
