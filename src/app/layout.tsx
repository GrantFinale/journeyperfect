import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: {
    default: "JourneyPerfect — Plan Perfect Vacations",
    template: "%s | JourneyPerfect",
  },
  description: "Plan perfect vacations, effortlessly. Organize itineraries, discover activities, and manage every detail of your trips.",
  keywords: ["travel", "vacation planning", "itinerary", "trip planner"],
  icons: { icon: "/jp-icon.png" },
  manifest: "/manifest.json",
}

// Root layout has NO client providers and NO next/font/google.
// Providers are added in (app)/layout.tsx only.
// This prevents /_global-error and /_not-found prerender crashes.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/jp-icon.png" />
        <meta name="theme-color" content="#4f46e5" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="apple-touch-icon" href="/jp-icon.png" />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(function(){})}`
          }}
        />
      </body>
    </html>
  )
}
