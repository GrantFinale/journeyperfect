"use server"

import { requireTripAccess } from "@/lib/auth-trip"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"

export async function getExpenseSummary(tripId: string) {
  await requireTripAccess(tripId)

  const items = await prisma.budgetItem.findMany({
    where: { tripId },
    orderBy: { createdAt: "desc" },
  })

  // Calculate who owes whom
  const balances: Record<string, number> = {} // person -> net balance (positive = owed money, negative = owes money)

  for (const item of items) {
    const paidBy = item.paidBy || "Unknown"
    const splitAmong = item.splitAmong.length > 0 ? item.splitAmong : [paidBy]
    const perPerson = item.amount / splitAmong.length

    // Person who paid gets credit
    balances[paidBy] = (balances[paidBy] || 0) + item.amount

    // Everyone in the split owes their share
    for (const person of splitAmong) {
      balances[person] = (balances[person] || 0) - perPerson
    }
  }

  // Calculate settlements (simplified: who owes whom)
  const settlements: { from: string; to: string; amount: number }[] = []
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < -0.01)
    .sort((a, b) => a[1] - b[1])
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > 0.01)
    .sort((a, b) => b[1] - a[1])

  let d = 0,
    c = 0
  const dAmounts = debtors.map(([name, amt]) => ({ name, amount: Math.abs(amt) }))
  const cAmounts = creditors.map(([name, amt]) => ({ name, amount: amt }))

  while (d < dAmounts.length && c < cAmounts.length) {
    const settleAmt = Math.min(dAmounts[d].amount, cAmounts[c].amount)
    if (settleAmt > 0.01) {
      settlements.push({
        from: dAmounts[d].name,
        to: cAmounts[c].name,
        amount: Math.round(settleAmt * 100) / 100,
      })
    }
    dAmounts[d].amount -= settleAmt
    cAmounts[c].amount -= settleAmt
    if (dAmounts[d].amount < 0.01) d++
    if (cAmounts[c].amount < 0.01) c++
  }

  return { items, balances, settlements }
}

export async function getTripPeople(tripId: string) {
  await requireTripAccess(tripId)

  // Get travelers
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      travelers: { include: { traveler: true } },
      collaborators: {
        where: { status: "ACCEPTED" },
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      user: { select: { id: true, name: true, email: true } },
    },
  })

  if (!trip) return []

  const people: { id: string; name: string; type: "traveler" | "collaborator" | "owner" }[] = []

  // Add owner
  people.push({
    id: trip.user.id,
    name: trip.user.name || trip.user.email,
    type: "owner",
  })

  // Add travelers
  for (const t of trip.travelers) {
    people.push({
      id: t.traveler.id,
      name: t.traveler.name,
      type: "traveler",
    })
  }

  // Add collaborators
  for (const c of trip.collaborators) {
    if (c.user && c.user.id !== trip.user.id) {
      people.push({
        id: c.user.id,
        name: c.user.name || c.user.email,
        type: "collaborator",
      })
    }
  }

  // Deduplicate by name
  const seen = new Set<string>()
  return people.filter((p) => {
    if (seen.has(p.name)) return false
    seen.add(p.name)
    return true
  })
}

export type ExpenseSummaryResult = Awaited<ReturnType<typeof getExpenseSummary>>
export type TripPerson = Awaited<ReturnType<typeof getTripPeople>>[number]
