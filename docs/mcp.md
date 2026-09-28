# JourneyPerfect MCP server

JourneyPerfect exposes the trip graph to external agents over the
[Model Context Protocol](https://modelcontextprotocol.io). A user talking to
Claude, ChatGPT or Gemini can say "add that flight to my Portugal trip" and it
lands in JourneyPerfect with the confirmation number, the check-in window and
the To Do state intact. This is the "trip system of record" play from
`docs/plans/flights-search-tracking-and-booking.md` §7.

## Endpoint

```
POST https://www.journeyperfect.com/api/mcp
```

- Transport: MCP **Streamable HTTP**, protocol version `2025-06-18` (the
  `2025-03-26` and `2024-11-05` revisions are also accepted on `initialize`).
- Request and response bodies are JSON-RPC 2.0, `application/json`. The server
  never opens an SSE stream; every call completes in one round trip.
- Stateless: no `Mcp-Session-Id`. `initialize` may be repeated at any time.
- `GET` and `DELETE` return `405`.
- JSON-RPC batches (arrays) are accepted. A body of only notifications gets
  `202 Accepted` with an empty body.

Implementation: `src/app/api/mcp/route.ts` (HTTP), `src/lib/mcp/server.ts`
(JSON-RPC dispatch), `src/lib/mcp/tools.ts` (tools), `src/lib/mcp/auth.ts`
(keys). The MCP SDK is deliberately not used.

## Authentication

Every request carries a per-user API key as a bearer token:

```
Authorization: Bearer jp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

- Keys are created and revoked at **Settings → API Keys**
  (`/settings/api-keys`). The plaintext is shown exactly once; only its SHA-256
  is stored (`ApiKey.keyHash`). Up to 10 active keys per user.
- A key acts as its owner: it can read every trip the user owns or has accepted
  a collaboration on, and write to trips where the user is the owner or an
  `EDITOR` collaborator. `VIEWER` collaborators get read tools only.
- Agent access is gated by the `mcpAccess` feature (Personal plan and above).
  A key belonging to a Free-plan user is rejected with `403`.
- Missing, malformed or revoked key: `401` with `WWW-Authenticate: Bearer`.

### Connecting

Claude Code:

```
claude mcp add --transport http journeyperfect https://www.journeyperfect.com/api/mcp \
  --header "Authorization: Bearer jp_..."
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "journeyperfect": {
      "type": "http",
      "url": "https://www.journeyperfect.com/api/mcp",
      "headers": { "Authorization": "Bearer jp_..." }
    }
  }
}
```

The settings page renders both snippets with the endpoint URL filled in from
`NEXT_PUBLIC_APP_URL` (falling back to `NEXTAUTH_URL`).

## Tools

All ids are opaque strings returned by earlier calls. Calendar days are
`YYYY-MM-DD`; instants are ISO 8601. Every tool returns one `text` content
block containing JSON. Failures come back as `isError: true` content with an
`{ "error": "..." }` body and never include stack traces or database errors.

| Tool | Access | Purpose |
| --- | --- | --- |
| `list_trips` | read | Trips the user owns or collaborates on, soonest first. `includePast` (bool) adds finished trips. |
| `get_trip` | read | One trip: summary, ordered destinations, travellers, counts. `{ tripId }` |
| `create_trip` | write (owner) | `{ title, destination, startDate, endDate, originLabel? }`. Enforces the plan's trip limit; origin defaults to the saved home address. |
| `get_itinerary` | read | Itinerary items in day order with linked flight, activity, hotel and reservation. `{ tripId, date? }` |
| `add_flight` | write | `{ tripId, airline, flightNumber, departureAirport, departureTime, arrivalAirport, arrivalTime, departureTimezone?, arrivalTimezone?, confirmationNumber?, price?, priceCurrency?, cabin?, bookingLink? }`. Creates the Flight, a `FLIGHT` itinerary item dated in the departure timezone, a FLIGHTS budget line when priced, and extends the trip end date if the arrival is later. Same behaviour as adding a flight in the app (`src/lib/flight-records.ts`). |
| `add_reservation` | write | `{ tripId, itineraryItemId, confirmationNumber?, provider?, bookingUrl?, price?, currency?, partySize?, notes? }`. Upserts the item's Reservation (merge on update). A confirmation number clears the "make reservation" task. |
| `list_outstanding_tasks` | read | The To Do list for a trip: `MAKE_RESERVATION`, `ADD_CONFIRMATION`, `MAKE_PAYMENT`, `CHECK_IN`, most urgent first. Uses the same rules as the app's To Do screen (`src/lib/trip-tasks.ts`). |
| `add_activity` | write | `{ tripId, name, category?, date?, notes? }`. Adds a `WISHLIST` activity; `date` pins it to a day (`isFixed`). |

Write tools require `EDITOR` access; a viewer gets an `isError` result saying
so. Unknown trips and trips the user cannot see both return "Trip not found".

### Example

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "add_flight", "arguments": {
    "tripId": "clx...", "airline": "TAP", "flightNumber": "TP 208",
    "departureAirport": "JFK", "departureTime": "2026-05-02T21:30:00-04:00",
    "departureTimezone": "America/New_York",
    "arrivalAirport": "LIS", "arrivalTime": "2026-05-03T09:15:00+01:00",
    "arrivalTimezone": "Europe/Lisbon",
    "confirmationNumber": "K7Q2ZP", "price": 612, "priceCurrency": "USD" } } }
```

## Limits

- **Rate limit:** 120 requests per minute per API key, fixed window, in
  process memory. Exceeding it returns `429` with `Retry-After: 60`. On a
  multi-instance deployment each instance keeps its own counter.
- **Trip limit:** `create_trip` honours the plan's `maxTrips` exactly as the
  app does.
- **Payload:** one JSON-RPC message or batch per request; there is no
  streaming, so long-running work is not supported.
- **Scope:** no delete tools and no user or billing tools are exposed. Keys
  cannot manage other keys.

## Errors

| HTTP | Meaning |
| --- | --- |
| 400 | Body is not valid JSON (`-32700`) or the batch is empty (`-32600`). |
| 401 | No or invalid API key. |
| 403 | Key is valid but the plan lacks `mcpAccess`. |
| 405 | Method other than POST. |
| 429 | Rate limit exceeded. |

JSON-RPC level: `-32600` invalid request, `-32601` unknown method, `-32602`
bad `tools/call` params or unknown tool, `-32603` a tool handler threw (the
message is always the generic "Internal error").

## Tests

`npx vitest run src/__tests__/mcp-*` covers the JSON-RPC dispatcher with a
fake authenticator and tool registry, plus key generation and parsing.
