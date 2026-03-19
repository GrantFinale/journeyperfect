import type { PrismaConfig } from "prisma"

export default {
  earlyAccess: true,
  migrate: {
    url: process.env.DATABASE_URL,
  },
} satisfies PrismaConfig
