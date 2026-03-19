import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "./db"

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      checks: ["state"],
    }),
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id
      // @ts-expect-error -- extending session type
      session.user.isAdmin = (user as any).isAdmin ?? false
      return session
    },
  },
  pages: {
    signIn: "/login",
  },
})
