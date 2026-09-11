// tests/unit/notification-bell.test.tsx (RC10 #26)
// The header bell is a real, working entry point now: it links to the live Phase 3
// inbox and surfaces the unread count as a badge. Regression test: badge only when
// unread > 0, accessible label carries the count, no dead click target.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NotificationBell } from '@/components/layout/NotificationBell'

describe('NotificationBell (#26)', () => {
  it('links to the notification inbox', () => {
    render(<NotificationBell unreadCount={0} />)
    expect(screen.getByRole('link', { name: 'Benachrichtigungen' })).toHaveAttribute(
      'href',
      '/notifications',
    )
  })

  it('renders no badge when everything is read', () => {
    render(<NotificationBell unreadCount={0} />)
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Benachrichtigungen' })).toBeInTheDocument()
  })

  it('shows the unread count as a badge and in the accessible label', () => {
    render(<NotificationBell unreadCount={3} />)
    expect(screen.getByRole('link', { name: 'Benachrichtigungen, 3 ungelesen' })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('caps the badge at 99+', () => {
    render(<NotificationBell unreadCount={250} />)
    expect(screen.getByRole('link', { name: 'Benachrichtigungen, 250 ungelesen' })).toBeInTheDocument()
    expect(screen.getByText('99+')).toBeInTheDocument()
  })
})
