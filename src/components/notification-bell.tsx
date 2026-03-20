"use client"

import { useState, useEffect, useRef } from "react"
import { Bell } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/actions/notifications"

type Notification = {
  id: string
  type: string
  title: string
  message: string
  link: string | null
  read: boolean
  createdAt: Date | string
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Fetch unread count on mount
  useEffect(() => {
    getUnreadCount()
      .then(setUnreadCount)
      .catch(() => {})
  }, [])

  // Fetch notifications when dropdown opens
  useEffect(() => {
    if (open && !loaded) {
      getNotifications(20)
        .then((data) => {
          setNotifications(data)
          setLoaded(true)
        })
        .catch(() => {})
    }
  }, [open, loaded])

  async function handleNotificationClick(notification: Notification) {
    if (!notification.read) {
      await markNotificationRead(notification.id).catch(() => {})
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n))
      )
      setUnreadCount((c) => Math.max(0, c - 1))
    }
    if (notification.link) {
      window.location.href = notification.link
    }
    setOpen(false)
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead().catch(() => {})
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  function formatTime(date: Date | string) {
    const d = new Date(date)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-accent"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 && loaded && (
              <div className="py-10 text-center">
                <Bell className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No notifications</p>
              </div>
            )}
            {!loaded && (
              <div className="py-10 text-center">
                <p className="text-sm text-muted-foreground">Loading...</p>
              </div>
            )}
            {notifications.map((notification) => (
              <button
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-border/50 hover:bg-accent/50 transition-colors",
                  !notification.read && "bg-primary/5"
                )}
              >
                <div className="flex items-start gap-3">
                  {!notification.read && (
                    <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />
                  )}
                  <div className={cn("flex-1 min-w-0", notification.read && "ml-5")}>
                    <p className="text-sm font-medium text-foreground truncate">
                      {notification.title}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {notification.message}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {formatTime(notification.createdAt)}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
