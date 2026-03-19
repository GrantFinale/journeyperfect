import type { NextConfig } from "next"
import path from "path"

// Provide build-time fallback so Prisma generate doesn't fail
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://build:build@localhost:5432/journeyperfect"
}

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sonner", "@tanstack/react-query"],
  // Memory optimizations for Docker builds on constrained servers
  productionBrowserSourceMaps: false,
  webpack: (config) => {
    // Force single React instance to prevent useContext null errors
    // on Linux Docker builds where duplicate packages can occur
    config.resolve.alias = {
      ...config.resolve.alias,
      react: path.resolve("./node_modules/react"),
      "react-dom": path.resolve("./node_modules/react-dom"),
    }
    return config
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
