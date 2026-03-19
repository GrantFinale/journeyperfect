import path from "node:path"
import type { PrismaConfig } from "prisma"
import { PrismaPg } from "@prisma/adapter-pg"

export default {
  earlyAccess: true,
  schema: path.join("prisma", "schema.prisma"),
  migrate: {
    async adapter(env: Record<string, string | undefined>) {
      const connectionString =
        env.DATABASE_URL ??
        "postgresql://build:build@localhost:5432/journeyperfect"
      return new PrismaPg({ connectionString })
    },
  },
} satisfies PrismaConfig
