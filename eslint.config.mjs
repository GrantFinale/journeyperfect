import { dirname } from "path"
import { fileURLToPath } from "url"
import { FlatCompat } from "@eslint/eslintrc"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  // Build output and agent worktrees are not source.
  { ignores: [".next/**", ".claude/**", "services/**/dist/**", "extensions/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
]

export default eslintConfig
