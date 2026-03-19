import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock prisma
const mockPrismaUser = {
  findUnique: vi.fn(),
  update: vi.fn(),
}
const mockPrismaSubscription = {
  findUnique: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
}
const mockPrismaTransaction = vi.fn((ops: unknown[]) => Promise.resolve(ops))

vi.mock("@/lib/db", () => ({
  prisma: {
    user: mockPrismaUser,
    subscription: mockPrismaSubscription,
    $transaction: mockPrismaTransaction,
  },
}))

// Mock stripe
const mockConstructEvent = vi.fn()
const mockRetrieveSubscription = vi.fn()

vi.mock("stripe", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      webhooks: {
        constructEvent: mockConstructEvent,
      },
      subscriptions: {
        retrieve: mockRetrieveSubscription,
      },
    })),
  }
})

// Import the handler after mocks are set up
// We need to dynamically import since the module reads env at import time
async function callWebhook(body: string, signature: string | null) {
  const { POST } = await import("@/app/api/stripe/webhook/route")
  const headers = new Headers()
  if (signature) headers.set("stripe-signature", signature)
  const request = new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    body,
    headers,
  })
  return POST(request)
}

describe("Stripe Webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects requests with missing stripe-signature", async () => {
    const response = await callWebhook("{}", null)
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toBe("Missing stripe-signature")
  })

  it("rejects requests with invalid stripe-signature", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature")
    })

    const response = await callWebhook("{}", "invalid_sig")
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toContain("Webhook Error")
  })

  it("processes checkout.session.completed correctly", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { userId: "user_123", plan: "PERSONAL" },
          subscription: "sub_abc",
          customer: "cus_xyz",
        },
      },
    })

    mockPrismaSubscription.findUnique.mockResolvedValue(null)
    mockRetrieveSubscription.mockResolvedValue({
      items: { data: [{ price: { id: "price_personal" } }] },
      current_period_start: 1700000000,
      current_period_end: 1702592000,
    })
    mockPrismaTransaction.mockResolvedValue([])

    const response = await callWebhook("{}", "valid_sig")
    expect(response.status).toBe(200)

    expect(mockPrismaSubscription.findUnique).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: "sub_abc" },
    })
    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1)
  })

  it("handles duplicate webhook delivery (idempotency)", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { userId: "user_123", plan: "PERSONAL" },
          subscription: "sub_abc",
          customer: "cus_xyz",
        },
      },
    })

    // Subscription already exists - should be a no-op
    mockPrismaSubscription.findUnique.mockResolvedValue({
      id: "existing_sub",
      stripeSubscriptionId: "sub_abc",
    })

    const response = await callWebhook("{}", "valid_sig")
    expect(response.status).toBe(200)

    // Transaction should NOT have been called since subscription already exists
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("sets plan to FREE on subscription deletion", async () => {
    mockConstructEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_abc",
          customer: "cus_xyz",
        },
      },
    })

    mockPrismaUser.findUnique.mockResolvedValue({ id: "user_123" })
    mockPrismaTransaction.mockResolvedValue([])

    const response = await callWebhook("{}", "valid_sig")
    expect(response.status).toBe(200)

    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1)
    // Verify the transaction includes setting plan to FREE
    const transactionCalls = mockPrismaTransaction.mock.calls[0][0]
    expect(transactionCalls).toHaveLength(2)
  })
})
