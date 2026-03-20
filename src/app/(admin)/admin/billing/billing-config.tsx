"use client"

import { useState } from "react"
import {
  CreditCard,
  CheckCircle2,
  XCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  stripeKeys: Record<string, string>
  allConfigured: boolean
}

const PLANS = [
  {
    name: "Personal",
    price: "$9/mo",
    envVar: "STRIPE_PRICE_PERSONAL_ID",
    features: ["10 trips", "6 travelers per trip", "Trip sharing"],
  },
  {
    name: "Family",
    price: "$19/mo",
    envVar: "STRIPE_PRICE_FAMILY_ID",
    features: ["25 trips", "10 travelers per trip", "Trip sharing"],
  },
  {
    name: "Pro",
    price: "$39/mo",
    envVar: "STRIPE_PRICE_PRO_ID",
    features: ["Unlimited trips", "Unlimited travelers", "Trip sharing"],
  },
]

const SETUP_STEPS = [
  {
    title: "Create a Stripe account",
    description:
      'Sign up at stripe.com and complete account verification. Enable "Test mode" while developing.',
  },
  {
    title: "Get your API keys",
    description:
      'Go to Developers > API keys. Copy the "Secret key" and "Publishable key". Add them as STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in your environment.',
  },
  {
    title: "Create Products and Prices",
    description:
      "Go to Products > + Add product. Create three products: Personal ($9/mo), Family ($19/mo), Pro ($39/mo). For each, create a recurring monthly price. Copy each Price ID (starts with price_).",
  },
  {
    title: "Set Price IDs in environment",
    description:
      "Add the three Price IDs as STRIPE_PRICE_PERSONAL_ID, STRIPE_PRICE_FAMILY_ID, and STRIPE_PRICE_PRO_ID in your environment variables.",
  },
  {
    title: "Set up the webhook",
    description:
      'Go to Developers > Webhooks > + Add endpoint. Set the URL to https://your-domain.com/api/stripe/webhook. Select events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted. Copy the "Signing secret" and add it as STRIPE_WEBHOOK_SECRET.',
  },
]

export function BillingConfig({ stripeKeys, allConfigured }: Props) {
  const [showGuide, setShowGuide] = useState(!allConfigured)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Billing / Stripe
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure Stripe for subscription billing
          </p>
        </div>
        <a
          href="https://dashboard.stripe.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2.5 bg-[#635BFF] text-white text-sm font-medium rounded-xl hover:bg-[#5851DB] transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          Stripe Dashboard
        </a>
      </div>

      {/* Status Overview */}
      <div
        className={cn(
          "border rounded-2xl p-5 mb-6",
          allConfigured
            ? "bg-green-50 border-green-200"
            : "bg-amber-50 border-amber-200"
        )}
      >
        <div className="flex items-center gap-3">
          {allConfigured ? (
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          ) : (
            <XCircle className="w-5 h-5 text-amber-600" />
          )}
          <div>
            <p
              className={cn(
                "font-medium",
                allConfigured ? "text-green-800" : "text-amber-800"
              )}
            >
              {allConfigured
                ? "Stripe is fully configured"
                : "Stripe setup incomplete"}
            </p>
            <p
              className={cn(
                "text-sm",
                allConfigured ? "text-green-600" : "text-amber-600"
              )}
            >
              {allConfigured
                ? "All environment variables are set and ready."
                : "Some environment variables are missing. Follow the setup guide below."}
            </p>
          </div>
        </div>
      </div>

      {/* Environment Variables */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Environment Variables
        </h2>
        <div className="space-y-3">
          {Object.entries(stripeKeys).map(([key, value]) => {
            const isSet = value !== "Not set"
            const isSecret =
              key === "STRIPE_SECRET_KEY" ||
              key === "STRIPE_WEBHOOK_SECRET" ||
              key === "STRIPE_PUBLISHABLE_KEY"
            const displayValue = isSecret && isSet ? "Configured" : value

            return (
              <div
                key={key}
                className={cn(
                  "flex items-center justify-between px-4 py-3 rounded-xl border",
                  isSet
                    ? "border-green-200 bg-green-50"
                    : "border-red-200 bg-red-50"
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "w-2.5 h-2.5 rounded-full flex-shrink-0",
                      isSet ? "bg-green-500" : "bg-red-500"
                    )}
                  />
                  <div>
                    <p
                      className={cn(
                        "text-sm font-mono font-medium",
                        isSet ? "text-green-900" : "text-red-900"
                      )}
                    >
                      {key}
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        isSet ? "text-green-600" : "text-red-600"
                      )}
                    >
                      {displayValue}
                    </p>
                  </div>
                </div>
                {!isSecret && isSet && (
                  <button
                    onClick={() => copyToClipboard(value, key)}
                    className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {copiedKey === key ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Plan Products */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Stripe Products
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PLANS.map((plan) => {
            const priceId = stripeKeys[plan.envVar]
            const isSet = priceId !== "Not set"
            return (
              <div
                key={plan.name}
                className={cn(
                  "border rounded-xl p-4",
                  isSet ? "border-green-200" : "border-gray-200"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-900">{plan.name}</h3>
                  <span className="text-sm font-medium text-indigo-600">
                    {plan.price}
                  </span>
                </div>
                <ul className="text-xs text-gray-500 space-y-1 mb-3">
                  {plan.features.map((f) => (
                    <li key={f}>- {f}</li>
                  ))}
                </ul>
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full",
                      isSet ? "bg-green-500" : "bg-red-400"
                    )}
                  />
                  <span
                    className={cn(
                      "text-xs font-mono",
                      isSet ? "text-green-700" : "text-red-600"
                    )}
                  >
                    {isSet ? priceId : "Not configured"}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Setup Guide */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-gray-900">
              Setup Guide
            </h2>
          </div>
          {showGuide ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>
        {showGuide && (
          <div className="px-5 pb-5 border-t border-gray-100">
            <div className="mt-4 space-y-4">
              {SETUP_STEPS.map((step, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold">
                    {i + 1}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">
                      {step.title}
                    </h3>
                    <p className="text-sm text-gray-600 mt-0.5">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 bg-gray-50 rounded-xl">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                Required Environment Variables
              </h3>
              <pre className="text-xs text-gray-600 font-mono whitespace-pre-wrap">
{`# Stripe API Keys
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Stripe Price IDs (from Products > Prices)
STRIPE_PRICE_PERSONAL_ID=price_...
STRIPE_PRICE_FAMILY_ID=price_...
STRIPE_PRICE_PRO_ID=price_...`}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
