"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getConfig } from "@/lib/config"
import { nanoid } from "nanoid"
import { revalidatePath } from "next/cache"

// Get or create the current user's referral code
export async function getMyReferralCode(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) throw new Error("User not found")

  if (user.referralCode) return user.referralCode

  // Generate a new code
  const code = nanoid(8).toUpperCase()
  await prisma.user.update({ where: { id: user.id }, data: { referralCode: code } })
  return code
}

// Get referral stats for the current user
export async function getMyReferralStats() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const referrals = await prisma.referral.findMany({
    where: { referrerId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { referee: { select: { name: true, email: true, plan: true } } },
  })

  const enabled = (await getConfig("referral.enabled", "true")) === "true"
  const rewardDescription = await getConfig("referral.reward", "PERSONAL")
  const maxRewards = parseInt(await getConfig("referral.maxRewardsPerUser", "10"))

  return {
    referrals,
    stats: {
      total: referrals.length,
      signedUp: referrals.filter((r) => r.status !== "PENDING").length,
      converted: referrals.filter((r) =>
        ["CONVERTED", "REWARDED"].includes(r.status)
      ).length,
      rewarded: referrals.filter((r) => r.status === "REWARDED").length,
    },
    config: { enabled, rewardDescription, maxRewards },
  }
}

// Apply a referral code when a new user signs up
export async function applyReferralCode(code: string) {
  const session = await auth()
  if (!session?.user?.id) return

  const enabled = (await getConfig("referral.enabled", "true")) === "true"
  if (!enabled) return

  const referrer = await prisma.user.findFirst({ where: { referralCode: code } })
  if (!referrer || referrer.id === session.user.id) return // can't refer yourself

  // Check if already referred
  const existing = await prisma.referral.findFirst({
    where: { refereeId: session.user.id },
  })
  if (existing) return

  await prisma.referral.create({
    data: {
      referrerId: referrer.id,
      refereeId: session.user.id,
      code,
      status: "SIGNED_UP",
    },
  })

  await prisma.user.update({
    where: { id: session.user.id },
    data: { referredBy: code },
  })
}

// Check and apply referral rewards when a user upgrades their plan
// Call this from the Stripe webhook handler
export async function processReferralReward(userId: string) {
  const enabled = (await getConfig("referral.enabled", "true")) === "true"
  if (!enabled) return

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return

  const requiredPlan = await getConfig("referral.requiredPlan", "PERSONAL")
  const planOrder = ["FREE", "PERSONAL", "FAMILY", "PRO"]
  if (planOrder.indexOf(user.plan) < planOrder.indexOf(requiredPlan)) return

  // Find the referral for this user
  const referral = await prisma.referral.findFirst({
    where: { refereeId: userId, status: "SIGNED_UP" },
  })
  if (!referral) return

  // Mark as converted
  await prisma.referral.update({
    where: { id: referral.id },
    data: { status: "CONVERTED", convertedAt: new Date() },
  })

  // Check if referrer has reached max rewards
  const maxRewards = parseInt(
    await getConfig("referral.maxRewardsPerUser", "10")
  )
  const rewardCount = await prisma.referral.count({
    where: { referrerId: referral.referrerId, status: "REWARDED" },
  })
  if (rewardCount >= maxRewards) return

  // Apply reward to referrer
  const reward = await getConfig("referral.reward", "PERSONAL")
  await prisma.user.update({
    where: { id: referral.referrerId },
    data: { plan: reward as any },
  })

  await prisma.referral.update({
    where: { id: referral.id },
    data: { status: "REWARDED", rewardGiven: true },
  })

  revalidatePath("/settings/referrals")
}
