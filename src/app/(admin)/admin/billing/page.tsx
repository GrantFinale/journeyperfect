import { BillingConfig } from "./billing-config"

export default function BillingPage() {
  const stripeKeys = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? "Configured" : "Not set",
    STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? "Configured" : "Not set",
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ? "Configured" : "Not set",
    STRIPE_PRICE_PERSONAL_ID: process.env.STRIPE_PRICE_PERSONAL_ID || "Not set",
    STRIPE_PRICE_FAMILY_ID: process.env.STRIPE_PRICE_FAMILY_ID || "Not set",
    STRIPE_PRICE_PRO_ID: process.env.STRIPE_PRICE_PRO_ID || "Not set",
  }

  const allConfigured = Object.values(stripeKeys).every(v => v !== "Not set")

  return <BillingConfig stripeKeys={stripeKeys} allConfigured={allConfigured} />
}
