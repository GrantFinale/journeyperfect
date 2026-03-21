"use server"

import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const documentSchema = z.object({
  type: z.enum(["BOARDING_PASS","HOTEL_CONFIRMATION","VISA","PASSPORT","INSURANCE","RENTAL_CAR","OTHER"]),
  title: z.string().min(1),
  fileUrl: z.string().optional(),
  externalLink: z.string().optional(),
  confirmationCode: z.string().optional(),
  notes: z.string().optional(),
  flightId: z.string().optional(),
  hotelId: z.string().optional(),
})

export async function getDocuments(tripId: string) {
  await requireTripAccess(tripId)

  return prisma.travelDocument.findMany({
    where: { tripId },
    include: { flight: true, hotel: true },
    orderBy: { createdAt: "desc" },
  })
}

export async function createDocument(tripId: string, data: z.infer<typeof documentSchema>) {
  await requireTripAccess(tripId, "EDITOR")

  const parsed = documentSchema.parse(data)
  const doc = await prisma.travelDocument.create({
    data: { tripId, ...parsed },
  })

  revalidatePath(`/trip/${tripId}/documents`)
  return doc
}

export type DocumentResult = Awaited<ReturnType<typeof createDocument>>
export type DocumentFull = Awaited<ReturnType<typeof getDocuments>>[number]

export async function deleteDocument(tripId: string, documentId: string) {
  await requireTripAccess(tripId, "EDITOR")
  await prisma.travelDocument.delete({ where: { id: documentId, tripId } })
  revalidatePath(`/trip/${tripId}/documents`)
}
