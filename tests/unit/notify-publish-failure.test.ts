// tests/unit/notify-publish-failure.test.ts (RC3 issue #51)
// A failing Redis publish inside notifyUser must not propagate: the durable Notification row is
// the source of truth (the inbox + the SSE stream's connect-time resync both read it from the
// DB), so the publish is best-effort like the email/push sends. Seams mocked on '@/' imports,
// same pattern as tests/unit/notify-triggers.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    notification: { create: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/redis', () => ({ redis: { publish: vi.fn() } }))
vi.mock('@/lib/mailer', () => ({ sendNotificationEmail: vi.fn() }))
vi.mock('@/lib/webPush', () => ({ sendPushToUser: vi.fn() }))

import { prisma } from '@/lib/db'
import { redis } from '@/lib/redis'
import { notifyUser } from '@/lib/notify'

const notificationCreate = vi.mocked(prisma.notification.create)
const publish = vi.mocked(redis.publish)

beforeEach(() => {
  vi.clearAllMocks()
  notificationCreate.mockImplementation(
    ((args: { data: object }) => Promise.resolve({ id: 'n1', ...args.data })) as typeof notificationCreate
  )
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    notifyEmail: false,
    notifyMatchLifecycle: false,
    notifyMatchLifecycleEmail: false,
    isMinor: false,
    email: null,
  } as never)
})

describe('notifyUser Redis publish failure (issue #51)', () => {
  it('still resolves (and keeps the row) when redis.publish rejects', async () => {
    publish.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      notifyUser('user-1', { title: 'Titel', message: 'Nachricht', link: '/events/1' })
    ).resolves.toBeUndefined()

    // The durable row — the source of truth — was still created before the publish attempt.
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', title: 'Titel' }) })
    )
    expect(publish).toHaveBeenCalledWith('notify:user-1', expect.any(String))
  })

  it('logs the publish error instead of throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    publish.mockRejectedValue(new Error('Connection timeout'))

    await notifyUser('user-2', { title: 'Titel', message: 'Nachricht' })

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('user-2'), expect.any(Error))
    consoleError.mockRestore()
  })

  it('publishes normally when Redis is healthy', async () => {
    publish.mockResolvedValue(1)

    await notifyUser('user-3', { title: 'Titel', message: 'Nachricht' })

    expect(publish).toHaveBeenCalledTimes(1)
  })
})
