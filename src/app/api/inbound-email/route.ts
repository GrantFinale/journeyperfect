import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { parseFlightTextWithAI } from "@/lib/flight-parser-ai"
import { parseHotelTextWithAI } from "@/lib/hotel-parser-ai"
import { parseRentalCarTextWithAI } from "@/lib/rental-car-parser-ai"
import { sendInboundConfirmation } from "@/lib/email"
import { getConfig } from "@/lib/config"
import { logAIUsage } from "@/lib/ai-usage"
import { formatDateInTimezone } from "@/lib/utils"

export const dynamic = "force-dynamic"

// Detect email type from content keywords
type EmailType = "flight" | "hotel" | "rental_car" | "restaurant" | "event"

function detectEmailTypes(content: string): EmailType[] {
  const lower = content.toLowerCase()
  const types: EmailType[] = []

  if (/flight|boarding|airline|departure gate|arrival gate|terminal|seat\s?\d|itinerary.*air/i.test(lower)) {
    types.push("flight")
  }
  if (/hotel|check.?in|check.?out|room\s*(type|rate|number)|accommodation|booking\s*confirmation.*stay|nights?\s*stay/i.test(lower)) {
    types.push("hotel")
  }
  if (/rental\s*(car|vehicle)|car\s*rental|pickup.*dropoff|dropoff.*pickup|enterprise|hertz|avis|budget|national|alamo|dollar|thrifty|sixt|turo|zipcar/i.test(lower)) {
    types.push("rental_car")
  }
  if (/restaurant\s*reservation|dining\s*reservation|table\s*for|party\s*size|opentable|resy|seated|reservation.*restaurant/i.test(lower)) {
    types.push("restaurant")
  }
  if (/ticket\s*(confirmation|number)|event\s*ticket|admission|venue.*seat|section.*row|concert|show\s*ticket|general\s*admission|e-?ticket|ticketmaster|stubhub|axs|eventbrite/i.test(lower)) {
    types.push("event")
  }

  // If nothing detected, try broader flight/hotel patterns
  if (types.length === 0) {
    if (/confirm.*flight|flight.*confirm|boarding\s*pass/i.test(lower)) types.push("flight")
    if (/confirm.*hotel|hotel.*confirm|reservation.*room/i.test(lower)) types.push("hotel")
  }

  return types
}

// Extract clean text from HTML, handling multipart MIME
function extractEmailBody(text: string, html: string): string {
  // Prefer text content if it has substance
  if (text && text.trim().length > 100) {
    return text.trim()
  }

  // Strip HTML to get readable text
  if (html) {
    return html
      // Remove style and script tags with content
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      // Convert common elements to readable format
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/td>/gi, " | ")
      .replace(/<\/th>/gi, " | ")
      .replace(/<li>/gi, "- ")
      .replace(/<\/li>/gi, "\n")
      // Remove remaining tags
      .replace(/<[^>]*>/g, " ")
      // Clean up whitespace
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim()
  }

  return text?.trim() || ""
}

// AI parser for restaurant reservations
async function parseRestaurantWithAI(text: string, userId?: string) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const model = await getConfig("ai.restaurantParserModel", "anthropic/claude-haiku-4.5")

  const prompt = `You are parsing a restaurant reservation confirmation email. Ignore marketing and promotional content. Focus ONLY on the reservation details.

Return a JSON object:
{
  "restaurants": [
    {
      "name": "The French Laundry",
      "address": "6640 Washington St, Yountville, CA 94599",
      "date": "2025-06-15",
      "time": "19:30",
      "timezone": "America/Los_Angeles",
      "partySize": 4,
      "confirmationNumber": "RES123456",
      "notes": "Outdoor seating requested"
    }
  ]
}

Rules:
- Date in YYYY-MM-DD format
- Time in HH:MM 24-hour format
- Use IANA timezone names
- Include full restaurant name and address when available
- Omit fields that cannot be determined
- Return ONLY valid JSON, no other text

Text to parse:
${text}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) return null

    const data = await response.json()

    if (userId && data.usage) {
      logAIUsage({
        userId,
        feature: "restaurant_parser",
        model,
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
      })
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    let jsonStr = content.trim()
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) jsonStr = match[1].trim()

    const parsed = JSON.parse(jsonStr)
    if (!parsed.restaurants || !Array.isArray(parsed.restaurants)) return null

    return parsed.restaurants as Array<{
      name?: string
      address?: string
      date?: string
      time?: string
      timezone?: string
      partySize?: number
      confirmationNumber?: string
      notes?: string
    }>
  } catch {
    console.error("[restaurant-parser] Failed to parse")
    return null
  }
}

// AI parser for event tickets
async function parseEventWithAI(text: string, userId?: string) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const model = await getConfig("ai.eventParserModel", "anthropic/claude-haiku-4.5")

  const prompt = `You are parsing an event ticket confirmation email. Ignore marketing and promotional content. Focus ONLY on the ticket/event details.

Return a JSON object:
{
  "events": [
    {
      "name": "Taylor Swift | The Eras Tour",
      "venue": "AT&T Stadium",
      "venueAddress": "1 AT&T Way, Arlington, TX 76011",
      "date": "2025-06-20",
      "time": "19:00",
      "timezone": "America/Chicago",
      "seatInfo": "Section 112, Row 15, Seats 3-4",
      "ticketCount": 2,
      "confirmationNumber": "TK987654",
      "price": 350.00,
      "priceCurrency": "USD",
      "notes": "Mobile tickets only"
    }
  ]
}

Rules:
- Date in YYYY-MM-DD format
- Time in HH:MM 24-hour format (doors open or show start, whichever is primary)
- Use IANA timezone names
- Include full venue name and address when available
- seatInfo: section, row, seat numbers as shown
- ticketCount: number of tickets in the order
- price: per ticket or total (note which in notes)
- Omit fields that cannot be determined
- Return ONLY valid JSON, no other text

Text to parse:
${text}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) return null

    const data = await response.json()

    if (userId && data.usage) {
      logAIUsage({
        userId,
        feature: "event_parser",
        model,
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
      })
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    let jsonStr = content.trim()
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) jsonStr = match[1].trim()

    const parsed = JSON.parse(jsonStr)
    if (!parsed.events || !Array.isArray(parsed.events)) return null

    return parsed.events as Array<{
      name?: string
      venue?: string
      venueAddress?: string
      date?: string
      time?: string
      timezone?: string
      seatInfo?: string
      ticketCount?: number
      confirmationNumber?: string
      price?: number
      priceCurrency?: string
      notes?: string
    }>
  } catch {
    console.error("[event-parser] Failed to parse")
    return null
  }
}

// This endpoint receives inbound emails via SendGrid/Mailgun webhook
// Email is sent to: trips+{userId}@inbound.journeyperfect.com
// The +{userId} part identifies the user
export async function POST(request: NextRequest) {
  // Verify webhook secret to prevent unauthorized access
  const webhookSecret = process.env.INBOUND_WEBHOOK_SECRET
  if (webhookSecret) {
    const headerSecret = request.headers.get("x-webhook-secret")
    if (headerSecret !== webhookSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

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

    // Extract clean email body from text/html
    const emailContent = extractEmailBody(text, html)

    if (!emailContent) {
      return NextResponse.json({ status: "ignored", reason: "empty email" })
    }

    // Include subject in content for better parsing context
    const fullContent = subject ? `Subject: ${subject}\n\n${emailContent}` : emailContent

    // Detect what types of confirmation this email contains
    const detectedTypes = detectEmailTypes(fullContent)

    // Always store as PendingEmail for the "new trip" email-first flow
    // We'll parse it and store the parsed data alongside the raw email
    const fromAddress = (formData.get("from") as string) || ""

    // Get user's most recent upcoming trip
    const now = new Date()
    const trip = await prisma.trip.findFirst({
      where: {
        userId,
        endDate: { gte: now },
      },
      orderBy: { startDate: "asc" },
    })

    // If no trip exists, store as pending email for the "new trip" flow
    if (!trip) {
      console.log("[inbound-email] No upcoming trips, storing as pending for user:", userId)

      for (const emailType of detectedTypes.length > 0 ? detectedTypes : [null]) {
        // Parse the email based on type
        let parsedData: Record<string, unknown> | null = null

        if (emailType === "flight") {
          try {
            const result = await parseFlightTextWithAI(fullContent, userId)
            if (result?.flights?.length) parsedData = { flights: result.flights }
          } catch { /* ignore parse errors for pending */ }
        } else if (emailType === "hotel") {
          try {
            const result = await parseHotelTextWithAI(fullContent, userId)
            if (result?.hotels?.length) parsedData = { hotels: result.hotels }
          } catch { /* ignore */ }
        } else if (emailType === "rental_car") {
          try {
            const result = await parseRentalCarTextWithAI(fullContent, userId)
            if (result?.rentalCars?.length) parsedData = { rentalCars: result.rentalCars }
          } catch { /* ignore */ }
        }

        await prisma.pendingEmail.create({
          data: {
            userId,
            from: fromAddress,
            subject,
            body: fullContent.slice(0, 50000), // cap body size
            type: emailType,
            parsedData: parsedData ? JSON.parse(JSON.stringify(parsedData)) : undefined,
          },
        })
      }

      return NextResponse.json({ status: "pending", message: "Stored as pending email" })
    }

    if (detectedTypes.length === 0) {
      console.log("[inbound-email] Could not detect email type for user:", userId)
      return NextResponse.json({ status: "ignored", reason: "unrecognized email type" })
    }

    const results: string[] = []

    // Process flights
    if (detectedTypes.includes("flight")) {
      try {
        const flightResult = await parseFlightTextWithAI(fullContent, userId)
        if (flightResult && flightResult.flights.length > 0) {
          for (const f of flightResult.flights) {
            if (f.departureTime && f.arrivalTime) {
              const depTime = new Date(f.departureTime)
              const arrTime = new Date(f.arrivalTime)
              const durationMins = Math.round((arrTime.getTime() - depTime.getTime()) / 60000)
              const route = [f.departureAirport, f.arrivalAirport].filter(Boolean).join(" \u2192 ")
              const title = `${f.airline || ""} ${f.flightNumber || "Flight"}${route ? ` \u00B7 ${route}` : ""}`.trim()
              // Use departure timezone for the itinerary date
              const depTz = f.departureTimezone || "UTC"
              const localDate = formatDateInTimezone(depTime, "yyyy-MM-dd", depTz)
              const localTime = formatDateInTimezone(depTime, "HH:mm", depTz)
              const localEndTime = formatDateInTimezone(arrTime, "HH:mm", depTz)

              await prisma.flight.create({
                data: {
                  tripId: trip.id,
                  airline: f.airline,
                  flightNumber: f.flightNumber,
                  departureAirport: f.departureAirport,
                  departureCity: f.departureCity,
                  departureTime: depTime,
                  departureTimezone: depTz,
                  arrivalAirport: f.arrivalAirport,
                  arrivalCity: f.arrivalCity,
                  arrivalTime: arrTime,
                  arrivalTimezone: f.arrivalTimezone || "UTC",
                  confirmationNumber: f.confirmationNumber,
                  cabin: f.cabin,
                  itineraryItems: {
                    create: {
                      tripId: trip.id,
                      date: new Date(localDate + "T00:00:00Z"),
                      startTime: localTime,
                      endTime: localEndTime,
                      type: "FLIGHT",
                      title,
                      durationMins,
                      position: 0,
                      isConfirmed: true,
                    },
                  },
                },
              })
              results.push(`Flight: ${f.airline || ""} ${f.flightNumber || ""}`.trim())
            }
          }
        }
      } catch (err) {
        console.error("[inbound-email] Flight parsing failed:", err)
      }
    }

    // Process hotels
    if (detectedTypes.includes("hotel")) {
      try {
        const hotelResult = await parseHotelTextWithAI(fullContent, userId)
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
              results.push(`Hotel: ${h.name || "Hotel"}`)
            }
          }
        }
      } catch (err) {
        console.error("[inbound-email] Hotel parsing failed:", err)
      }
    }

    // Process rental cars
    if (detectedTypes.includes("rental_car")) {
      try {
        const carResult = await parseRentalCarTextWithAI(fullContent, userId)
        if (carResult && carResult.rentalCars.length > 0) {
          for (const c of carResult.rentalCars) {
            if (c.pickupTime && c.dropoffTime) {
              const pickupTime = new Date(c.pickupTime)
              const dropoffTime = new Date(c.dropoffTime)

              const rentalCar = await prisma.rentalCar.create({
                data: {
                  tripId: trip.id,
                  company: c.company,
                  confirmationNumber: c.confirmationNumber,
                  vehicleType: c.vehicleType,
                  pickupLocation: c.pickupLocation,
                  pickupAddress: c.pickupAddress,
                  pickupTime,
                  pickupTimezone: c.pickupTimezone || "UTC",
                  dropoffLocation: c.dropoffLocation,
                  dropoffAddress: c.dropoffAddress,
                  dropoffTime,
                  dropoffTimezone: c.dropoffTimezone || "UTC",
                  price: c.price,
                  priceCurrency: c.priceCurrency,
                  notes: c.notes,
                },
              })

              // Auto-create pickup/dropoff itinerary items
              const pickupTitle = `${c.company || "Car"} pickup${c.pickupLocation ? ` at ${c.pickupLocation}` : ""}`
              const dropoffTitle = `${c.company || "Car"} dropoff${c.dropoffLocation ? ` at ${c.dropoffLocation}` : ""}`

              await prisma.itineraryItem.createMany({
                data: [
                  {
                    tripId: trip.id,
                    rentalCarId: rentalCar.id,
                    date: pickupTime,
                    startTime: pickupTime.toTimeString().slice(0, 5),
                    type: "RENTAL_CAR_PICKUP",
                    title: pickupTitle,
                    durationMins: 30,
                    position: 0,
                    isConfirmed: true,
                  },
                  {
                    tripId: trip.id,
                    rentalCarId: rentalCar.id,
                    date: dropoffTime,
                    startTime: dropoffTime.toTimeString().slice(0, 5),
                    type: "RENTAL_CAR_DROPOFF",
                    title: dropoffTitle,
                    durationMins: 30,
                    position: 0,
                    isConfirmed: true,
                  },
                ],
              })

              results.push(`Rental car: ${c.company || ""} ${c.vehicleType || ""}`.trim())
            }
          }
        }
      } catch (err) {
        console.error("[inbound-email] Rental car parsing failed:", err)
      }
    }

    // Process restaurant reservations (create as Activity)
    if (detectedTypes.includes("restaurant")) {
      try {
        const restaurants = await parseRestaurantWithAI(fullContent, userId)
        if (restaurants && restaurants.length > 0) {
          for (const r of restaurants) {
            const dateTime = r.date && r.time
              ? new Date(`${r.date}T${r.time}:00`)
              : r.date
                ? new Date(`${r.date}T12:00:00`)
                : null

            await prisma.activity.create({
              data: {
                tripId: trip.id,
                name: r.name || "Restaurant reservation",
                description: [
                  r.confirmationNumber ? `Confirmation: ${r.confirmationNumber}` : null,
                  r.partySize ? `Party size: ${r.partySize}` : null,
                  r.notes || null,
                ].filter(Boolean).join("\n"),
                address: r.address,
                category: "restaurant",
                durationMins: 90,
                priority: "HIGH",
                isFixed: !!dateTime,
                fixedDateTime: dateTime,
                indoorOutdoor: "INDOOR",
                reservationNeeded: true,
              },
            })
            results.push(`Restaurant: ${r.name || "reservation"}`)
          }
        }
      } catch (err) {
        console.error("[inbound-email] Restaurant parsing failed:", err)
      }
    }

    // Process event tickets (create as Activity)
    // Skip if this email was also detected as a flight — flight emails often
    // contain "e-ticket" or "ticket confirmation" which triggers event detection
    if (detectedTypes.includes("event") && !detectedTypes.includes("flight")) {
      try {
        const events = await parseEventWithAI(fullContent, userId)
        if (events && events.length > 0) {
          for (const e of events) {
            const dateTime = e.date && e.time
              ? new Date(`${e.date}T${e.time}:00`)
              : e.date
                ? new Date(`${e.date}T19:00:00`)
                : null

            await prisma.activity.create({
              data: {
                tripId: trip.id,
                name: e.name || "Event",
                description: [
                  e.venue ? `Venue: ${e.venue}` : null,
                  e.seatInfo ? `Seats: ${e.seatInfo}` : null,
                  e.confirmationNumber ? `Confirmation: ${e.confirmationNumber}` : null,
                  e.ticketCount ? `Tickets: ${e.ticketCount}` : null,
                  e.notes || null,
                ].filter(Boolean).join("\n"),
                address: e.venueAddress,
                category: "event",
                durationMins: 180,
                costPerAdult: e.price || 0,
                priority: "MUST_DO",
                isFixed: !!dateTime,
                fixedDateTime: dateTime,
                indoorOutdoor: "INDOOR",
                reservationNeeded: false,
              },
            })
            results.push(`Event: ${e.name || "ticket"}`)
          }
        }
      } catch (err) {
        console.error("[inbound-email] Event parsing failed:", err)
      }
    }

    console.log(
      `[inbound-email] Processed for user ${userId}, trip ${trip.id}: ${results.join(", ") || "nothing detected"}`
    )

    // Send confirmation email back to the user
    if (results.length > 0 && user.email) {
      const itemsSummary = results.length === 1
        ? `Added ${results[0]} to your trip.`
        : `Added ${results.length} items to your trip:\n${results.map(r => `- ${r}`).join("\n")}`

      // Fire and forget - don't block the response
      sendInboundConfirmation(user.email, itemsSummary, trip.title || trip.destination || "your trip").catch(
        (err) => console.error("[inbound-email] Failed to send confirmation email:", err)
      )
    }

    return NextResponse.json({ status: "ok", processed: results })
  } catch (err) {
    console.error("[inbound-email] Error:", err)
    return NextResponse.json({ error: "Processing failed" }, { status: 500 })
  }
}
