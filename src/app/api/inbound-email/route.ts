import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { parseFlightTextWithAI } from "@/lib/flight-parser-ai"
import { parseHotelTextWithAI } from "@/lib/hotel-parser-ai"

export const dynamic = "force-dynamic"

// This endpoint receives inbound emails via SendGrid/Mailgun webhook
// Email is sent to: trips+{userId}@inbound.journeyperfect.com
// The +{userId} part identifies the user
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    // SendGrid Inbound Parse format
    const to = (formData.get("to") as string) || ""
    const subject = (formData.get("subject") as string) || ""
    const text = (formData.get("text") as string) || ""
    const html = (formData.get("html") as string) || ""

    // Extract userId from the to address: trips+{userId}@inbound.journeyperfect.com
    const userMatch = to.match(/trips\+([a-zA-Z0-9]+)@/)
    if (!userMatch) {
      console.error("[inbound-email] Could not extract userId from:", to)
      return NextResponse.json({ error: "Invalid recipient" }, { status: 400 })
    }

    const userId = userMatch[1]

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      console.error("[inbound-email] User not found:", userId)
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Check paid plan
    if (user.plan === "FREE") {
      console.log("[inbound-email] Free user, ignoring:", userId)
      return NextResponse.json({ status: "ignored", reason: "free plan" })
    }

    // Use text content, fallback to stripped html
    const emailContent =
      text ||
      html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()

    if (!emailContent) {
      return NextResponse.json({ status: "ignored", reason: "empty email" })
    }

    // Get user's most recent upcoming trip
    const now = new Date()
    const trip = await prisma.trip.findFirst({
      where: {
        userId,
        endDate: { gte: now },
      },
      orderBy: { startDate: "asc" },
    })

    if (!trip) {
      console.log("[inbound-email] No upcoming trips found for user:", userId)
      return NextResponse.json({ status: "ignored", reason: "no trips" })
    }

    // Try to detect what type of confirmation this is
    const lowerContent = emailContent.toLowerCase()
    const isFlightEmail =
      /flight|boarding|airline|departure|arrival|terminal|gate|seat/i.test(lowerContent)
    const isHotelEmail =
      /hotel|check.?in|check.?out|reservation|room|accommodation|booking confirmation/i.test(
        lowerContent
      )

    const results: string[] = []

    if (isFlightEmail) {
      const flightResult = await parseFlightTextWithAI(emailContent)
      if (flightResult && flightResult.flights.length > 0) {
        for (const f of flightResult.flights) {
          if (f.departureTime && f.arrivalTime) {
            await prisma.flight.create({
              data: {
                tripId: trip.id,
                airline: f.airline,
                flightNumber: f.flightNumber,
                departureAirport: f.departureAirport,
                departureCity: f.departureCity,
                departureTime: new Date(f.departureTime),
                departureTimezone: f.departureTimezone || "UTC",
                arrivalAirport: f.arrivalAirport,
                arrivalCity: f.arrivalCity,
                arrivalTime: new Date(f.arrivalTime),
                arrivalTimezone: f.arrivalTimezone || "UTC",
                confirmationNumber: f.confirmationNumber,
                cabin: f.cabin,
              },
            })
            results.push(`Flight: ${f.airline || ""} ${f.flightNumber || ""}`)
          }
        }
      }
    }

    if (isHotelEmail) {
      const hotelResult = await parseHotelTextWithAI(emailContent)
      if (hotelResult && hotelResult.hotels.length > 0) {
        for (const h of hotelResult.hotels) {
          if (h.checkIn && h.checkOut) {
            await prisma.hotel.create({
              data: {
                tripId: trip.id,
                name: h.name || "Hotel",
                address: h.address,
                checkIn: new Date(h.checkIn),
                checkOut: new Date(h.checkOut),
                confirmationNumber: h.confirmationNumber,
                roomCount: h.roomCount || 1,
                roomType: h.roomType,
                price: h.price,
              },
            })
            results.push(`Hotel: ${h.name || ""}`)
          }
        }
      }
    }

    console.log(
      `[inbound-email] Processed for user ${userId}, trip ${trip.id}: ${results.join(", ") || "nothing detected"}`
    )

    return NextResponse.json({ status: "ok", processed: results })
  } catch (err) {
    console.error("[inbound-email] Error:", err)
    return NextResponse.json({ error: "Processing failed" }, { status: 500 })
  }
}
