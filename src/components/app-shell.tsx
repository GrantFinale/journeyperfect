"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import {
  LayoutDashboard,
  CalendarDays,
  Star,
  DollarSign,
  FileText,
  Settings,
  Compass,
  Utensils,
  Menu,
  X,
  Map,
  ChevronLeft,
  User,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { signOut } from "next-auth/react"

interface AppShellProps {
  children: React.ReactNode
  user: { name?: string | null; email?: string | null; image?: string | null; id: string }
}

type NavItem = {
  href: string
  label: string
  icon: typeof LayoutDashboard
  exact?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/settings", label: "Settings", icon: Settings },
]

const TRIP_NAV_ITEMS = (tripId: string): NavItem[] => [
  { href: `/trip/${tripId}`, label: "Overview", icon: Map, exact: true },
  { href: `/trip/${tripId}/itinerary`, label: "Itinerary", icon: CalendarDays },
  { href: `/trip/${tripId}/activities`, label: "Activities", icon: Star },
  { href: `/trip/${tripId}/discover`, label: "Discover", icon: Compass },
  { href: `/trip/${tripId}/dining`, label: "Dining", icon: Utensils },
  { href: `/trip/${tripId}/budget`, label: "Budget", icon: DollarSign },
  { href: `/trip/${tripId}/documents`, label: "Documents", icon: FileText },
  { href: `/trip/${tripId}/settings`, label: "Trip Settings", icon: Settings },
]

export function AppShell({ children, user }: AppShellProps) {
  const pathname = usePathname() ?? ""
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Extract trip ID from path if we're in a trip
  const tripMatch = pathname.match(/\/trip\/([^/]+)/)
  const currentTripId = tripMatch?.[1]
  const navItems = currentTripId ? TRIP_NAV_ITEMS(currentTripId) : NAV_ITEMS

  // Bottom nav items for mobile (most used)
  const BOTTOM_NAV = currentTripId
    ? [
        { href: `/trip/${currentTripId}`, label: "Overview", icon: Map },
        { href: `/trip/${currentTripId}/itinerary`, label: "Itinerary", icon: CalendarDays },
        { href: `/trip/${currentTripId}/activities`, label: "Activities", icon: Star },
        { href: `/trip/${currentTripId}/budget`, label: "Budget", icon: DollarSign },
        { href: `/trip/${currentTripId}/discover`, label: "Discover", icon: Compass },
      ]
    : [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/settings", label: "Settings", icon: Settings },
      ]

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-60 border-r border-border bg-card shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-4 border-b border-border">
          <img src="/jp-icon.png" alt="JourneyPerfect" className="w-8 h-8" />
          <span className="font-semibold text-foreground">JourneyPerfect</span>
        </div>

        {/* Back to dashboard if in trip */}
        {currentTripId && (
          <div className="px-3 pt-3">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              <ChevronLeft className="w-3 h-3" />
              All trips
            </Link>
          </div>
        )}

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {navItems.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href) && (item.href !== "/dashboard" || pathname === "/dashboard")
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2 px-2 py-2">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="w-7 h-7 rounded-full" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{user.name || user.email}</p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Out
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-card border-r border-border flex flex-col z-50">
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <img src="/jp-icon.png" alt="JourneyPerfect" className="w-8 h-8" />
                <span className="font-semibold">JourneyPerfect</span>
              </div>
              <button onClick={() => setSidebarOpen(false)}>
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-3 px-2">
              {navItems.map((item) => {
                const isActive = pathname.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-0.5",
                      isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
          <button onClick={() => setSidebarOpen(true)} className="text-muted-foreground">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <img src="/jp-icon.png" alt="JourneyPerfect" className="w-6 h-6" />
            <span className="font-semibold text-sm">JourneyPerfect</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {children}
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-30">
          <div className="flex">
            {BOTTOM_NAV.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    </div>
  )
}
