// components/layout/NotificationBell.tsx (RC10 #26)
// The Phase 3 inbox (/notifications + /api/notifications) is live, so the header bell is
// ACTIVE, not a placeholder: it links to the inbox and carries the unread count as a
// badge (count comes from the root layout's server-side query and is passed down).
// Zero unread renders no badge — an empty dot would be noise.
import Link from 'next/link'
import { Bell } from 'lucide-react'

export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const label =
    unreadCount > 0 ? `Benachrichtigungen, ${unreadCount} ungelesen` : 'Benachrichtigungen'
  return (
    <Link
      href="/notifications"
      aria-label={label}
      className="relative rounded-md p-2 text-current/80 transition-colors hover:bg-current/5 hover:text-current"
    >
      <Bell size={18} aria-hidden="true" />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-x-cyan px-1 text-[10px] font-bold text-base-dark"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  )
}
