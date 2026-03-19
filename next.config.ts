import type { NextConfig } from "next"

// Provide build-time fallback so Prisma generate doesn't fail
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://build:build@localhost:5432/journeyperfect"
}

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sonner", "@tanstack/react-query"],
  // Memory optimizations for Docker builds on constrained servers
  productionBrowserSourceMaps: false,
  experimental: {
    serverSourceMaps: false,
    webpackMemoryOptimizations: true,
    staticGenerationMaxConcurrency: 1,
    
  },
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
