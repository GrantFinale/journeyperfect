import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [],
    // The browser-runner and the Chrome extension are their own packages; agent worktrees are stale copies.
    exclude: ["**/node_modules/**", "services/**", "extensions/**", ".claude/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
