import type { NextConfig } from "next"

// Provide build-time fallback so Prisma generate doesn't fail
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://build:build@localhost:5432/journeyperfect"
}

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sonner", "@tanstack/react-query"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  productionBrowserSourceMaps: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "maps.googleapis.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "places.googleapis.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "*.gstatic.com" },
    ],
  },
}

export default nextConfig
