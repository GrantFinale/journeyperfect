/**
 * Duffel order creation (Phase 4 of docs/plans/flights-search-tracking-and-booking.md).
 *
 * Deep-link handoff is the default product; this module exists so booking can
 * be switched on from /admin/settings (`flights.bookingEnabled` = "true")
 * without a deploy. There is deliberately NO checkout UI yet.
 *
 * Requirements to actually place an order:
 *  - `api.duffel.token` set to a Duffel access token. Use a *test* token
 *    (`duffel_test_...`) until Duffel has approved live mode; test orders
 *    never charge anyone and `Order.live_mode` is false.
 *  - A Duffel *offer id* (`FlightOffer.providerRef` when provider = "duffel").
 *    Offers expire (`FlightOffer.expiresAt`); re-search when stale.
 *  - Full passenger details for every passenger on the offer request, in the
 *    same order: legal names, date of birth, gender, title, email, phone in
 *    E.164. Some fares also require identity documents (passport), which
 *    this helper does not collect: `offer.passenger_identity_documents_required`
 *    will make the order fail with a Duffel validation error.
 *  - Payment is taken from the Duffel balance (`payments[].type = "balance"`);
 *    with Duffel acting as merchant of record no travel accreditation is
 *    needed, but the balance must be funded in live mode.
 */
import type { CreateOrderPassenger, DuffelPassengerGender, DuffelPassengerTitle } from "@duffel/api/types"
import { getConfigKey, getConfigKeyBoolean } from "@/lib/config-keys"
import { BookingDisabledError, ProviderNotConfiguredError, ProviderRequestError } from "./errors"
import { createDuffelClient, DUFFEL_PROVIDER_ID } from "./providers/duffel"

export interface DuffelPassengerInput {
  givenName: string
  familyName: string
  /** YYYY-MM-DD */
  bornOn: string
  gender: "m" | "f"
  title: "mr" | "ms" | "mrs" | "miss" | "dr"
  email: string
  /** E.164, e.g. "+12125551234" */
  phoneNumber: string
}

export interface DuffelOrderResult {
  orderId: string
  /** Airline PNR / booking reference */
  bookingReference: string
  totalAmount: number
  currency: string
  liveMode: boolean
}

/**
 * Create an instant Duffel order for `offerId`. Throws BookingDisabledError
 * when the feature flag is off, ProviderNotConfiguredError without a token,
 * and ProviderRequestError for anything Duffel rejects (expired offer,
 * passenger count mismatch, missing documents, insufficient balance).
 */
export async function createDuffelOrder(offerId: string, passengers: DuffelPassengerInput[]): Promise<DuffelOrderResult> {
  if (!(await getConfigKeyBoolean("flights.bookingEnabled"))) throw new BookingDisabledError()
  const token = (await getConfigKey("api.duffel.token")).trim()
  if (!token) throw new ProviderNotConfiguredError(DUFFEL_PROVIDER_ID, "api.duffel.token")
  if (passengers.length === 0) throw new ProviderRequestError(DUFFEL_PROVIDER_ID, "At least one passenger is required")

  const client = createDuffelClient(token)
  try {
    const offerRes = await client.offers.get(offerId)
    const offer = offerRes.data
    if (offer.passengers.length !== passengers.length) {
      throw new ProviderRequestError(
        DUFFEL_PROVIDER_ID,
        `Offer was priced for ${offer.passengers.length} passenger(s) but ${passengers.length} were supplied`
      )
    }
    const orderPassengers = offer.passengers.map((op, i): CreateOrderPassenger => {
      const p = passengers[i]
      return {
        id: op.id,
        given_name: p.givenName.trim(),
        family_name: p.familyName.trim(),
        born_on: p.bornOn,
        gender: p.gender as DuffelPassengerGender,
        title: p.title as DuffelPassengerTitle,
        email: p.email.trim(),
        phone_number: p.phoneNumber.trim(),
      }
    })
    const orderRes = await client.orders.create({
      type: "instant",
      selected_offers: [offer.id],
      passengers: orderPassengers,
      payments: [{ type: "balance", amount: offer.total_amount, currency: offer.total_currency }],
      metadata: { source: "journeyperfect" },
    })
    const order = orderRes.data
    return {
      orderId: order.id,
      bookingReference: order.booking_reference,
      totalAmount: Number.parseFloat(order.total_amount),
      currency: order.total_currency,
      liveMode: order.live_mode,
    }
  } catch (err) {
    if (err instanceof ProviderRequestError) throw err
    const e = err as { message?: string; meta?: { status?: number }; errors?: { message?: string; title?: string }[] }
    const message = e.errors?.[0]?.message ?? e.errors?.[0]?.title ?? e.message ?? String(err)
    throw new ProviderRequestError(DUFFEL_PROVIDER_ID, message, e.meta?.status)
  }
}
