"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createFlight, createFlightsBatch, deleteFlight, parseAndPreviewFlight } from "@/lib/actions/flights"
import { createHotel, deleteHotel } from "@/lib/actions/hotels"
import { addTravelerToTrip, removeTravelerFromTrip } from "@/lib/actions/travelers"
import { updateTrip, deleteTrip, shareTrip, unshareTrip, addDestination, removeDestination } from "@/lib/actions/trips"
import { formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"
import {
  Plane,
  Hotel,
  Users,
  Settings,
  Plus,
  Trash2,
  X,
  ChevronRight,
  Share2,
  Copy,
  AlertTriangle,
  Clipboard,
  MapPin,
  CheckCircle2,
} from "lucide-react"
import PlacesAutocomplete from "@/components/places-autocomplete"

type TripDestinationType = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  position: number
}

type Trip = {
  id: string
  title: string
  destination: string
  destinations: TripDestinationType[]
  startDate: Date
  endDate: Date
  notes: string | null
  isPublic: boolean
  shareSlug: string | null
  flights: {
    id: string
    airline: string | null
    flightNumber: string | null
    departureAirport: string | null
    departureCity: string | null
    departureTime: Date
    arrivalAirport: string | null
    arrivalCity: string | null
    arrivalTime: Date
    confirmationNumber: string | null
    cabin: string | null
  }[]
  hotels: {
    id: string
    name: string
    address: string | null
    checkIn: Date
    checkOut: Date
    confirmationNumber: string | null
    isVacationRental: boolean
  }[]
  travelers: {
    id: string
    traveler: { id: string; name: string; tags: string[] }
  }[]
}

type TravelerProfile = { id: string; name: string; tags: string[]; isDefault: boolean }

interface Props {
  tripId: string
  trip: Trip
  allProfiles: TravelerProfile[]
}

const TABS = ["Flights", "Hotels", "Travelers", "General"] as const
type Tab = (typeof TABS)[number]

export function TripSettingsView({ tripId, trip: initialTrip, allProfiles }: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>("Flights")
  const [trip, setTrip] = useState<Trip>(initialTrip)

  // Flight state
  const [showFlightForm, setShowFlightForm] = useState(false)
  const [flightPasteText, setFlightPasteText] = useState("")
  const [parsedFlight, setParsedFlight] = useState<Record<string, string> | null>(null)
  const [parsingFlight, setParsingFlight] = useState(false)
  const [flightForm, setFlightForm] = useState({
    airline: "",
    flightNumber: "",
    departureAirport: "",
    departureTime: "",
    departureTimezone: "UTC",
    arrivalAirport: "",
    arrivalTime: "",
    arrivalTimezone: "UTC",
    confirmationNumber: "",
    cabin: "",
  })
  const [parsedFlights, setParsedFlights] = useState<Array<{
    airline: string; flightNumber: string; departureAirport: string;
    departureTime: string; departureTimezone: string; arrivalAirport: string;
    arrivalTime: string; arrivalTimezone: string; confirmationNumber: string; cabin: string;
  }>>([])
  const [addingBatchFlights, setAddingBatchFlights] = useState(false)

  // Hotel state
  const [showHotelForm, setShowHotelForm] = useState(false)
  const [hotelForm, setHotelForm] = useState({
    name: "",
    address: "",
    checkIn: "",
    checkOut: "",
    confirmationNumber: "",
    bookingLink: "",
    isVacationRental: false,
  })

  // General state
  const [generalForm, setGeneralForm] = useState({
    title: trip.title,
    startDate: trip.startDate.toISOString().split("T")[0],
    endDate: trip.endDate.toISOString().split("T")[0],
    notes: trip.notes || "",
  })
  const [savingGeneral, setSavingGeneral] = useState(false)
  const [deletingTrip, setDeletingTrip] = useState(false)

  // Destination state
  const [newDestinationName, setNewDestinationName] = useState("")
  const [newDestinationCoords, setNewDestinationCoords] = useState<{ lat?: number; lng?: number }>({})
  const [addingDestination, setAddingDestination] = useState(false)

  // Parse flight from text
  async function handleParseFlight() {
    if (!flightPasteText.trim()) return
    setParsingFlight(true)
    try {
      const result = await parseAndPreviewFlight(flightPasteText)
      if (result && result.flights.length > 0) {
        // Map all flights into form objects
        const allFlights = result.flights.map((f) => ({
          airline: f.airline || "",
          flightNumber: f.flightNumber || "",
          departureAirport: f.departureAirport || "",
          departureTime: f.departureTime ? new Date(f.departureTime).toISOString().slice(0, 16) : "",
          departureTimezone: f.departureTimezone || "UTC",
          arrivalAirport: f.arrivalAirport || "",
          arrivalTime: f.arrivalTime ? new Date(f.arrivalTime).toISOString().slice(0, 16) : "",
          arrivalTimezone: f.arrivalTimezone || "UTC",
          confirmationNumber: f.confirmationNumber || "",
          cabin: f.cabin || "",
        }))
        setParsedFlights(allFlights)
        setParsedFlight(result as unknown as Record<string, string>)
        // Set the manual form to the first flight as fallback
        setFlightForm(allFlights[0])
        toast.success(`Found ${result.flights.length} flight segment(s)!`)
      } else {
        setParsedFlights([])
        toast.error("Could not parse flight info — fill in manually below")
      }
    } catch {
      toast.error("Failed to parse flight")
    } finally {
      setParsingFlight(false)
    }
  }

  function clearFlightState() {
    setShowFlightForm(false)
    setFlightPasteText("")
    setParsedFlight(null)
    setParsedFlights([])
    setFlightForm({ airline: "", flightNumber: "", departureAirport: "", departureTime: "", departureTimezone: "UTC", arrivalAirport: "", arrivalTime: "", arrivalTimezone: "UTC", confirmationNumber: "", cabin: "" })
  }

  async function handleAddAllFlights() {
    if (parsedFlights.length === 0) return
    setAddingBatchFlights(true)
    try {
      const batchData = parsedFlights.map((f) => ({
        ...f,
        departureTime: new Date(f.departureTime).toISOString(),
        arrivalTime: new Date(f.arrivalTime).toISOString(),
        departureTimezone: f.departureTimezone || "UTC",
        arrivalTimezone: f.arrivalTimezone || "UTC",
        airline: f.airline || undefined,
        flightNumber: f.flightNumber || undefined,
        departureAirport: f.departureAirport || undefined,
        arrivalAirport: f.arrivalAirport || undefined,
        confirmationNumber: f.confirmationNumber || undefined,
        cabin: f.cabin || undefined,
      }))
      await createFlightsBatch(tripId, batchData)
      clearFlightState()
      router.refresh()
      toast.success(`Added ${batchData.length} flight(s)!`)
    } catch {
      toast.error("Failed to add flights")
    } finally {
      setAddingBatchFlights(false)
    }
  }

  async function handleAddFlight() {
    if (!flightForm.departureTime || !flightForm.arrivalTime) {
      toast.error("Departure and arrival times are required")
      return
    }
    try {
      const flight = await createFlight(tripId, {
        ...flightForm,
        departureTime: new Date(flightForm.departureTime).toISOString(),
        arrivalTime: new Date(flightForm.arrivalTime).toISOString(),
        departureTimezone: flightForm.departureTimezone || "UTC",
        arrivalTimezone: flightForm.arrivalTimezone || "UTC",
        airline: flightForm.airline || undefined,
        flightNumber: flightForm.flightNumber || undefined,
        departureAirport: flightForm.departureAirport || undefined,
        arrivalAirport: flightForm.arrivalAirport || undefined,
        confirmationNumber: flightForm.confirmationNumber || undefined,
        cabin: flightForm.cabin || undefined,
      })
      setTrip((prev) => ({ ...prev, flights: [...prev.flights, flight as unknown as Trip["flights"][0]] }))
      clearFlightState()
      toast.success("Flight added!")
    } catch {
      toast.error("Failed to add flight")
    }
  }

  async function handleDeleteFlight(flightId: string) {
    try {
      await deleteFlight(tripId, flightId)
      setTrip((prev) => ({ ...prev, flights: prev.flights.filter((f) => f.id !== flightId) }))
      toast.success("Flight removed")
    } catch {
      toast.error("Failed to remove flight")
    }
  }

  async function handleAddHotel() {
    if (!hotelForm.name || !hotelForm.checkIn || !hotelForm.checkOut) {
      toast.error("Name, check-in, and check-out dates are required")
      return
    }
    try {
      const hotel = await createHotel(tripId, {
        ...hotelForm,
        checkIn: new Date(hotelForm.checkIn).toISOString(),
        checkOut: new Date(hotelForm.checkOut).toISOString(),
        address: hotelForm.address || undefined,
        confirmationNumber: hotelForm.confirmationNumber || undefined,
        bookingLink: hotelForm.bookingLink || undefined,
      })
      setTrip((prev) => ({ ...prev, hotels: [...prev.hotels, hotel as unknown as Trip["hotels"][0]] }))
      setShowHotelForm(false)
      setHotelForm({ name: "", address: "", checkIn: "", checkOut: "", confirmationNumber: "", bookingLink: "", isVacationRental: false })
      toast.success("Hotel added!")
    } catch {
      toast.error("Failed to add hotel")
    }
  }

  async function handleDeleteHotel(hotelId: string) {
    try {
      await deleteHotel(tripId, hotelId)
      setTrip((prev) => ({ ...prev, hotels: prev.hotels.filter((h) => h.id !== hotelId) }))
      toast.success("Hotel removed")
    } catch {
      toast.error("Failed to remove hotel")
    }
  }

  async function handleToggleTraveler(profileId: string, currentlyAdded: boolean) {
    try {
      if (currentlyAdded) {
        await removeTravelerFromTrip(tripId, profileId)
        setTrip((prev) => ({ ...prev, travelers: prev.travelers.filter((t) => t.traveler.id !== profileId) }))
        toast.success("Traveler removed")
      } else {
        await addTravelerToTrip(tripId, profileId)
        const profile = allProfiles.find((p) => p.id === profileId)!
        setTrip((prev) => ({
          ...prev,
          travelers: [...prev.travelers, { id: profileId, traveler: profile }],
        }))
        toast.success("Traveler added")
      }
    } catch {
      toast.error("Failed to update travelers")
    }
  }

  async function handleAddDestination() {
    if (!newDestinationName.trim()) return
    setAddingDestination(true)
    try {
      const dest = await addDestination(tripId, newDestinationName.trim(), newDestinationCoords.lat, newDestinationCoords.lng)
      setTrip((prev) => ({
        ...prev,
        destinations: [...prev.destinations, dest as unknown as TripDestinationType],
        destination: [...prev.destinations.map((d) => d.name), newDestinationName.trim()].join(", "),
      }))
      setNewDestinationName("")
      setNewDestinationCoords({})
      toast.success("Destination added")
    } catch {
      toast.error("Failed to add destination")
    } finally {
      setAddingDestination(false)
    }
  }

  async function handleRemoveDestination(destinationId: string) {
    try {
      await removeDestination(tripId, destinationId)
      const remaining = trip.destinations.filter((d) => d.id !== destinationId)
      setTrip((prev) => ({
        ...prev,
        destinations: remaining,
        destination: remaining.map((d) => d.name).join(", "),
      }))
      toast.success("Destination removed")
    } catch {
      toast.error("Failed to remove destination")
    }
  }

  async function handleSaveGeneral() {
    setSavingGeneral(true)
    try {
      await updateTrip(tripId, generalForm)
      toast.success("Trip updated")
    } catch {
      toast.error("Failed to update trip")
    } finally {
      setSavingGeneral(false)
    }
  }

  async function handleShareToggle() {
    try {
      if (trip.isPublic) {
        const updated = await unshareTrip(tripId)
        setTrip((prev) => ({ ...prev, isPublic: updated.isPublic }))
        toast.success("Sharing disabled")
      } else {
        const updated = await shareTrip(tripId)
        setTrip((prev) => ({ ...prev, isPublic: updated.isPublic, shareSlug: updated.shareSlug }))
        toast.success("Share link created!")
      }
    } catch {
      toast.error("Failed to update sharing")
    }
  }

  async function handleDeleteTrip() {
    if (!confirm("Delete this trip? This cannot be undone.")) return
    setDeletingTrip(true)
    try {
      await deleteTrip(tripId)
      router.push("/dashboard")
    } catch {
      toast.error("Failed to delete trip")
      setDeletingTrip(false)
    }
  }

  const shareUrl = trip.shareSlug ? `${typeof window !== "undefined" ? window.location.origin : ""}/shared/${trip.shareSlug}` : ""

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Trip Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-8">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-1 py-2 text-sm font-medium rounded-lg transition-colors",
              activeTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* FLIGHTS TAB */}
      {activeTab === "Flights" && (
        <div>
          {trip.flights.length === 0 && !showFlightForm && (
            <div className="text-center py-12">
              <Plane className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No flights added yet</p>
              <p className="text-gray-400 text-xs mt-1">
                Paste a confirmation email to auto-import, or add manually
              </p>
            </div>
          )}

          {/* Flight list */}
          <div className="space-y-2 mb-4">
            {trip.flights.map((flight) => (
              <div
                key={flight.id}
                className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3 group"
              >
                <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
                  <Plane className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-900">
                    {flight.flightNumber || "Flight"} · {flight.departureAirport} → {flight.arrivalAirport}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(flight.departureTime, "MMM d, h:mm a")} →{" "}
                    {formatDate(flight.arrivalTime, "MMM d, h:mm a")}
                    {flight.confirmationNumber && ` · ${flight.confirmationNumber}`}
                    {flight.cabin && ` · ${flight.cabin}`}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteFlight(flight.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add flight button */}
          {!showFlightForm && (
            <button
              onClick={() => setShowFlightForm(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add flight
            </button>
          )}

          {/* Add flight form */}
          {showFlightForm && (
            <div className="bg-white border border-indigo-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Add Flight</h3>
                <button onClick={clearFlightState}>
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>

              {/* Paste & parse */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Paste confirmation email (optional — auto-parses)
                </label>
                <textarea
                  value={flightPasteText}
                  onChange={(e) => setFlightPasteText(e.target.value)}
                  rows={4}
                  placeholder="Paste your flight confirmation email here..."
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono text-xs"
                />
                <button
                  onClick={handleParseFlight}
                  disabled={parsingFlight || !flightPasteText.trim()}
                  className="mt-2 flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  <Clipboard className="w-3.5 h-3.5" />
                  {parsingFlight ? "Parsing..." : "Parse flight info"}
                </button>
              </div>

              {/* Parsed flights preview */}
              {parsedFlights.length > 1 && (
                <div className="mb-4 bg-gray-50 border border-gray-200 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-sm font-medium text-gray-900">
                      Found {parsedFlights.length} flight segments
                    </span>
                  </div>
                  <div className="space-y-2 mb-4">
                    {parsedFlights.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-100 rounded-xl"
                      >
                        <Plane className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                        <span className="text-sm text-gray-900 font-medium">
                          {f.flightNumber || "Flight"}
                        </span>
                        <span className="text-sm text-gray-500">
                          {f.departureAirport || "???"} &rarr; {f.arrivalAirport || "???"}
                        </span>
                        {f.departureTime && (
                          <span className="text-xs text-gray-400 ml-auto">
                            {new Date(f.departureTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })},{" "}
                            {new Date(f.departureTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleAddAllFlights}
                    disabled={addingBatchFlights}
                    className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {addingBatchFlights ? "Adding flights..." : `Add all ${parsedFlights.length} flights`}
                  </button>
                  <div className="flex items-center gap-3 mt-3">
                    <div className="flex-1 border-t border-gray-200" />
                    <span className="text-xs text-gray-400">or edit individually below</span>
                    <div className="flex-1 border-t border-gray-200" />
                  </div>
                </div>
              )}

              <div className="border-t border-gray-100 pt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Airline</label>
                    <input type="text" placeholder="Delta" value={flightForm.airline}
                      onChange={(e) => setFlightForm((f) => ({ ...f, airline: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Flight number</label>
                    <input type="text" placeholder="DL123" value={flightForm.flightNumber}
                      onChange={(e) => setFlightForm((f) => ({ ...f, flightNumber: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Departure *</label>
                    <input type="datetime-local" value={flightForm.departureTime}
                      onChange={(e) => setFlightForm((f) => ({ ...f, departureTime: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Arrival *</label>
                    <input type="datetime-local" value={flightForm.arrivalTime}
                      onChange={(e) => setFlightForm((f) => ({ ...f, arrivalTime: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">From airport</label>
                    <input type="text" placeholder="JFK" value={flightForm.departureAirport}
                      onChange={(e) => setFlightForm((f) => ({ ...f, departureAirport: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">To airport</label>
                    <input type="text" placeholder="NRT" value={flightForm.arrivalAirport}
                      onChange={(e) => setFlightForm((f) => ({ ...f, arrivalAirport: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Confirmation #</label>
                    <input type="text" placeholder="ABC123" value={flightForm.confirmationNumber}
                      onChange={(e) => setFlightForm((f) => ({ ...f, confirmationNumber: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Cabin class</label>
                    <select value={flightForm.cabin}
                      onChange={(e) => setFlightForm((f) => ({ ...f, cabin: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                      <option value="">Any</option>
                      <option value="Economy">Economy</option>
                      <option value="Premium Economy">Premium Economy</option>
                      <option value="Business">Business</option>
                      <option value="First">First</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <button onClick={clearFlightState}
                    className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50">
                    Cancel
                  </button>
                  <button onClick={handleAddFlight}
                    className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700">
                    Add flight
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* HOTELS TAB */}
      {activeTab === "Hotels" && (
        <div>
          {trip.hotels.length === 0 && !showHotelForm && (
            <div className="text-center py-12">
              <Hotel className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No hotels added yet</p>
            </div>
          )}

          <div className="space-y-2 mb-4">
            {trip.hotels.map((hotel) => (
              <div key={hotel.id} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3 group">
                <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center">
                  <Hotel className="w-4 h-4 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-900">
                    {hotel.isVacationRental ? "🏡 " : "🏨 "}{hotel.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(hotel.checkIn, "MMM d")} → {formatDate(hotel.checkOut, "MMM d, yyyy")}
                    {hotel.confirmationNumber && ` · ${hotel.confirmationNumber}`}
                    {hotel.address && ` · ${hotel.address}`}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteHotel(hotel.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {!showHotelForm && (
            <button
              onClick={() => setShowHotelForm(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add hotel / rental
            </button>
          )}

          {showHotelForm && (
            <div className="bg-white border border-indigo-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Add Hotel / Rental</h3>
                <button onClick={() => setShowHotelForm(false)}>
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              <div className="space-y-3">
                <input type="text" placeholder="Hotel / rental name *" value={hotelForm.name}
                  onChange={(e) => setHotelForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <input type="text" placeholder="Address" value={hotelForm.address}
                  onChange={(e) => setHotelForm((f) => ({ ...f, address: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Check-in *</label>
                    <input type="datetime-local" value={hotelForm.checkIn}
                      onChange={(e) => setHotelForm((f) => ({ ...f, checkIn: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Check-out *</label>
                    <input type="datetime-local" value={hotelForm.checkOut}
                      onChange={(e) => setHotelForm((f) => ({ ...f, checkOut: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" placeholder="Confirmation #" value={hotelForm.confirmationNumber}
                    onChange={(e) => setHotelForm((f) => ({ ...f, confirmationNumber: e.target.value }))}
                    className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
                  <input type="url" placeholder="Booking link" value={hotelForm.bookingLink}
                    onChange={(e) => setHotelForm((f) => ({ ...f, bookingLink: e.target.value }))}
                    className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={hotelForm.isVacationRental}
                    onChange={(e) => setHotelForm((f) => ({ ...f, isVacationRental: e.target.checked }))}
                    className="rounded" />
                  This is a vacation rental (Airbnb, VRBO, etc.)
                </label>
                <div className="flex gap-3 pt-1">
                  <button onClick={() => setShowHotelForm(false)}
                    className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50">
                    Cancel
                  </button>
                  <button onClick={handleAddHotel}
                    className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700">
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TRAVELERS TAB */}
      {activeTab === "Travelers" && (
        <div>
          {allProfiles.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No traveler profiles yet</p>
              <p className="text-gray-400 text-xs mt-1">
                Create traveler profiles in{" "}
                <a href="/settings" className="text-indigo-600 hover:underline">Settings</a>
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {allProfiles.map((profile) => {
                const added = trip.travelers.some((t) => t.traveler.id === profile.id)
                return (
                  <div
                    key={profile.id}
                    className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3"
                  >
                    <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center text-sm font-semibold text-gray-600">
                      {profile.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900">{profile.name}</div>
                      {profile.tags.length > 0 && (
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {profile.tags.map((tag) => (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleToggleTraveler(profile.id, added)}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                        added
                          ? "bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600"
                          : "bg-indigo-600 text-white hover:bg-indigo-700"
                      )}
                    >
                      {added ? "Remove" : "Add"}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* GENERAL TAB */}
      {activeTab === "General" && (
        <div className="space-y-6">
          {/* Edit trip details */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Trip Details</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Trip name</label>
                <input type="text" value={generalForm.title}
                  onChange={(e) => setGeneralForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Destinations</label>
                <div className="space-y-2">
                  {trip.destinations.map((dest) => (
                    <div
                      key={dest.id}
                      className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl group"
                    >
                      <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className="flex-1 text-sm text-gray-900">{dest.name}</span>
                      <button
                        onClick={() => handleRemoveDestination(dest.id)}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {trip.destinations.length === 0 && (
                    <p className="text-xs text-gray-400">No destinations yet</p>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <div className="relative flex-1">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 z-10" />
                    <PlacesAutocomplete
                      value={newDestinationName}
                      onChange={(val) => {
                        setNewDestinationName(val)
                        setNewDestinationCoords({})
                      }}
                      onSelect={(place) => {
                        setNewDestinationName(place.name)
                        setNewDestinationCoords({ lat: place.lat, lng: place.lng })
                      }}
                      placeholder="Search for a city..."
                      className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <button
                    onClick={handleAddDestination}
                    disabled={addingDestination || !newDestinationName.trim()}
                    className="px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Start date</label>
                  <input type="date" value={generalForm.startDate}
                    onChange={(e) => setGeneralForm((f) => ({ ...f, startDate: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">End date</label>
                  <input type="date" value={generalForm.endDate}
                    onChange={(e) => setGeneralForm((f) => ({ ...f, endDate: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <textarea value={generalForm.notes}
                  onChange={(e) => setGeneralForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
              <button
                onClick={handleSaveGeneral}
                disabled={savingGeneral}
                className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {savingGeneral ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>

          {/* Sharing */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Share Trip</h3>
            <p className="text-sm text-gray-500 mb-4">
              Create a public link anyone can view without signing in.
            </p>
            {trip.isPublic && trip.shareSlug && (
              <div className="flex items-center gap-2 mb-4 p-3 bg-green-50 rounded-xl border border-green-100">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 bg-transparent text-sm text-green-800 font-mono outline-none"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(shareUrl)
                    toast.success("Link copied!")
                  }}
                  className="p-1.5 text-green-600 hover:text-green-800 transition-colors"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            )}
            <button
              onClick={handleShareToggle}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors",
                trip.isPublic
                  ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              )}
            >
              <Share2 className="w-4 h-4" />
              {trip.isPublic ? "Disable sharing" : "Create share link"}
            </button>
          </div>

          {/* Danger zone */}
          <div className="bg-white border border-red-100 rounded-2xl p-5">
            <h3 className="font-semibold text-red-700 mb-1 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Danger Zone
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Deleting a trip removes all flights, hotels, activities, and budget items permanently.
            </p>
            <button
              onClick={handleDeleteTrip}
              disabled={deletingTrip}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              {deletingTrip ? "Deleting..." : "Delete this trip"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
