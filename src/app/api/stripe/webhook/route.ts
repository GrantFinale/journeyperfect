import { NextResponse } from "next/server"
import Stripe from "stripe"
import { prisma } from "@/lib/db"
import type { Plan } from "@/lib/plans"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-02-24.acacia",
  })
  const rawBody = await request.text()
  const sig = request.headers.get("stripe-signature")

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 })
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.metadata?.userId
      const plan = session.metadata?.plan as Plan | undefined

      if (!userId || !plan) break

      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id

      if (!subscriptionId) break

      // Idempotency: skip if this subscription already exists
      const existing = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      })
      if (existing) break

      const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId)

      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            plan,
            planStatus: "active",
            stripeCustomerId:
              typeof session.customer === "string"
                ? session.customer
                : session.customer?.id ?? undefined,
          },
        }),
        prisma.subscription.upsert({
          where: { userId },
          create: {
            userId,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: stripeSubscription.items.data[0]?.price.id ?? null,
            status: "active",
            currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          },
          update: {
            stripeSubscriptionId: subscriptionId,
            stripePriceId: stripeSubscription.items.data[0]?.price.id ?? null,
            status: "active",
            currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          },
        }),
      ])
      break
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id

      const user = await prisma.user.findUnique({
        where: { stripeCustomerId: customerId },
        select: { id: true },
      })

      if (!user) break

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { planStatus: subscription.status },
        }),
        prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          },
        }),
      ])
      break
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id

      const user = await prisma.user.findUnique({
        where: { stripeCustomerId: customerId },
        select: { id: true },
      })

      if (!user) break

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { plan: "FREE", planStatus: null },
        }),
        prisma.subscription.deleteMany({
          where: { stripeSubscriptionId: subscription.id },
        }),
      ])
      break
    }
  }

  return NextResponse.json({ received: true })
}
