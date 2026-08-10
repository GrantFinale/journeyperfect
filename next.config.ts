import type { NextConfig } from "next"

// Provide build-time fallback so Prisma generate doesn't fail
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://build:build@localhost:5432/journeyperfect"
}

const nextConfig: NextConfig = {
  output: "standalone",
  // NB: do not add React libraries to `serverExternalPackages`. Externalising a
  // package makes the server `require` it from node_modules instead of bundling
  // it, so it resolves its own copy of React while the render runs inside Next's
  // compiled React. The dispatcher is then null and any hook throws
  // "Cannot read properties of null (reading 'useEffect')" during SSR.
  // `sonner` and `@tanstack/react-query` were listed here and broke server
  // rendering on every route wrapped by <Providers> — i.e. the whole app shell.
  // That option is for packages that genuinely cannot be bundled (native addons).
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  productionBrowserSourceMaps: false,
  experimental: {
    serverActions: {
      // Event attachments are up to 5MB (MAX_ATTACHMENT_BYTES). Server Actions
      // default to a 1MB body limit, which would reject the upload before any
      // of our own validation ran. Headroom covers multipart overhead.
      bodySizeLimit: "6mb",
    },
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
