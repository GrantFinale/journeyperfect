import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Proxy Google Places photo requests server-side so the API key is never exposed to the client.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ photoRef: string }> }
) {
  const { photoRef } = await params
  const apiKey = process.env.GOOGLE_PLACES_KEY || process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY
  if (!apiKey || apiKey === "build-placeholder") {
    return new NextResponse("Not configured", { status: 503 })
  }

  // photoRef is the URL-encoded "places/{id}/photos/{ref}" resource name
  const resourceName = decodeURIComponent(photoRef)

  try {
    const url = `https://places.googleapis.com/v1/${resourceName}/media?maxWidthPx=400&key=${apiKey}`
    const res = await fetch(url, {
      redirect: "follow",
      referrer: "",
      referrerPolicy: "no-referrer",
    })

    if (!res.ok) {
      return new NextResponse("Photo not available", { status: res.status })
    }

    const contentType = res.headers.get("content-type") || "image/jpeg"
    const body = res.body

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    })
  } catch {
    return new NextResponse("Failed to fetch photo", { status: 502 })
  }
}
