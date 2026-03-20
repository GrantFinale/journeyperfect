"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createFlight, createFlightsBatch, deleteFlight, parseAndPreviewFlight } from "@/lib/actions/flights"
import { createHotel, createHotelsBatch, deleteHotel, parseAndPreviewHotel } from "@/lib/actions/hotels"
import { createRentalCar, deleteRentalCar, parseAndPreviewRentalCar } from "@/lib/actions/rental-cars"
import { getCompanyInfo, RENTAL_CAR_COMPANIES } from "@/lib/rental-car-logos"
import { addTravelerToTrip, removeTravelerFromTrip, updateTravelerProfile, deleteTravelerProfile } from "@/lib/actions/travelers"
import { updateTrip, deleteTrip, shareTrip, unshareTrip, addDestination, removeDestination } from "@/lib/actions/trips"
import { inviteCollaborator, removeCollaborator, updateCollaboratorRole } from "@/lib/actions/collaborators"
import { formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"
import {
  Plane,
  Hotel,
  Car,
  Users,
  Settings,
  Plus,
  Trash2,
  X,
  ChevronRight,
  ChevronDown,
  Share2,
  Copy,
  AlertTriangle,
  Clipboard,
  MapPin,
  CheckCircle2,
  UserPlus,
  Crown,
  Eye,
  Pencil,
  Mail,
} from "lucide-react"
import PlacesAutocomplete from "@/components/places-autocomplete"
import { AffiliateBadge } from "@/components/affiliate-links"
import { ForwardingEmail } from "@/components/forwarding-email"
import { getHotelAffiliate, getCarRentalAffiliate } from "@/lib/actions/affiliates"
import type { AffiliateLink } from "@/lib/affiliates"

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
  rentalCars: {
    id: string
    company: string | null
    vehicleType: string | null
    pickupLocation: string | null
    pickupTime: Date
    dropoffLocation: string | null
    dropoffTime: Date
    confirmationNumber: string | null
    price: number | null
    priceCurrency: string | null
  }[]
  travelers: {
    id: string
    traveler: { id: string; name: string; tags: string[] }
  }[]
}

type TravelerProfile = { id: string; name: string; tags: string[]; isDefault: boolean; birthDate?: Date | string | null }

type Collaborator = {
  id: string
  email: string
  role: "VIEWER" | "EDITOR"
  status: "PENDING" | "ACCEPTED" | "DECLINED"
  user: { name: string | null; email: string | null; image: string | null } | null
}

interface Props {
  tripId: string
  trip: Trip
  allProfiles: TravelerProfile[]
  initialTab?: string
  isOwner?: boolean
  ownerName?: string | null
  ownerEmail?: string | null
  initialCollaborators?: Collaborator[]
  placesApiKey?: string
  userId?: string
}

const TABS = ["Flights", "Hotels", "Cars", "Travelers", "Sharing", "General"] as const
type Tab = (typeof TABS)[number]

function tabFromParam(param?: string): Tab {
  if (!param) return "Flights"
  const lower = param.toLowerCase()
  const match = TABS.find((t) => t.toLowerCase() === lower)
  return match || "Flights"
}

function TravelerCard({ profile, added, tripId, onToggle }: { profile: TravelerProfile; added: boolean; tripId: string; onToggle: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile.name)
  const [birthDate, setBirthDate] = useState(profile.birthDate ? new Date(profile.birthDate).toISOString().split("T")[0] : "")
  const [tags, setTags] = useState(profile.tags.join(", "))
  const [saving, setSaving] = useState(false)

  const TAG_OPTIONS = ["adult", "child", "infant", "senior"]

  async function handleSave() {
    setSaving(true)
    try {
      await updateTravelerProfile(profile.id, {
        name: name.trim(),
        birthDate: birthDate || undefined,
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
      })
      setEditing(false)
      toast.success("Traveler updated")
    } catch {
      toast.error("Failed to update traveler")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete traveler profile "${profile.name}"? This cannot be undone.`)) return
    try {
      await deleteTravelerProfile(profile.id)
      toast.success("Traveler deleted")
    } catch {
      toast.error("Failed to delete traveler")
    }
  }

  if (editing) {
    return (
      <div className="bg-white border border-indigo-200 rounded-2xl p-4 space-y-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Birth date</label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tags</label>
            <div className="flex flex-wrap gap-1">
              {TAG_OPTIONS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    const current = tags.split(",").map(t => t.trim()).filter(Boolean)
                    if (current.includes(tag)) {
                      setTags(current.filter(t => t !== tag).join(", "))
                    } else {
                      setTags([...current, tag].join(", "))
                    }
                  }}
                  className={cn(
                    "px-2 py-1 text-xs rounded-lg border transition-colors",
                    tags.split(",").map(t => t.trim()).includes(tag)
                      ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                      : "bg-white border-gray-200 text-gray-500"
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between pt-1">
          <button onClick={handleDelete} className="text-xs text-red-500 hover:text-red-700">Delete profile</button>
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Cancel</button>
            <button onClick={handleSave} disabled={saving || !name.trim()} className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3 group">
      <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center text-sm font-semibold text-gray-600 shrink-0">
        {profile.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm text-gray-900">{profile.name}</div>
        {profile.tags.length > 0 && (
          <div className="flex gap-1 mt-0.5 flex-wrap">
            {profile.tags.map((tag) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{tag}</span>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={() => setEditing(true)}
        className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        Edit
      </button>
      <button
        onClick={onToggle}
        className={cn(
          "px-3 py-2 text-xs font-medium rounded-lg transition-colors",
          added ? "bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600" : "bg-indigo-600 text-white hover:bg-indigo-700"
        )}
      >
        {added ? "Remove" : "Add"}
      </button>
    </div>
  )
}

export function TripSettingsView({ tripId, trip: initialTrip, allProfiles, initialTab, isOwner = true, ownerName, ownerEmail, initialCollaborators = [], placesApiKey, userId }: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>(tabFromParam(initialTab))
  const [trip, setTrip] = useState<Trip>(initialTrip)

  // Collaborator state
  const [collaborators, setCollaborators] = useState<Collaborator[]>(initialCollaborators)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"VIEWER" | "EDITOR">("VIEWER")
  const [inviting, setInviting] = useState(false)

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
    price: "",
  })
  const [parsedFlights, setParsedFlights] = useState<Array<{
    airline: string; flightNumber: string; departureAirport: string;
    departureTime: string; departureTimezone: string; arrivalAirport: string;
    arrivalTime: string; arrivalTimezone: string; confirmationNumber: string; cabin: string;
    durationMins?: number;
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
    price: "",
    roomCount: "1",
    roomType: "",
  })

  // Hotel parsing state
  const [showHotelParse, setShowHotelParse] = useState(false)
  const [hotelPasteText, setHotelPasteText] = useState("")
  const [parsingHotel, setParsingHotel] = useState(false)
  const [parsedHotel, setParsedHotel] = useState<{
    name?: string; address?: string; checkIn?: string; checkOut?: string;
    confirmationNumber?: string; price?: number; priceCurrency?: string; roomCount?: number;
    roomType?: string; isVacationRental?: boolean;
  } | null>(null)

  // Rental car state
  const [showCarForm, setShowCarForm] = useState(false)
  const [showCarParse, setShowCarParse] = useState(false)
  const [carPasteText, setCarPasteText] = useState("")
  const [parsingCar, setParsingCar] = useState(false)
  const [parsedCar, setParsedCar] = useState<{
    company?: string; vehicleType?: string; pickupLocation?: string; pickupAddress?: string;
    pickupTime?: string; pickupTimezone?: string; dropoffLocation?: string; dropoffAddress?: string;
    dropoffTime?: string; dropoffTimezone?: string; confirmationNumber?: string;
    price?: number; priceCurrency?: string; bookingLink?: string; notes?: string;
  } | null>(null)
  const [carForm, setCarForm] = useState({
    company: "",
    companyOther: "",
    vehicleType: "",
    pickupLocation: "",
    pickupTime: "",
    pickupTimezone: "UTC",
    dropoffLocation: "",
    dropoffTime: "",
    dropoffTimezone: "UTC",
    confirmationNumber: "",
    bookingLink: "",
    price: "",
    notes: "",
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

  // Affiliate link state
  const [hotelAffiliateLink, setHotelAffiliateLink] = useState<AffiliateLink | null>(null)
  const [carRentalLink, setCarRentalLink] = useState<AffiliateLink | null>(null)

  useEffect(() => {
    // Fetch hotel affiliate link
    getHotelAffiliate(
      trip.destination,
      trip.startDate.toISOString().split("T")[0],
      trip.endDate.toISOString().split("T")[0]
    ).then(setHotelAffiliateLink)
    // Fetch car rental affiliate link
    getCarRentalAffiliate(
      trip.destination,
      trip.startDate.toISOString().split("T")[0],
      trip.endDate.toISOString().split("T")[0]
    ).then(setCarRentalLink)
  }, [trip.destination, trip.startDate, trip.endDate])

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
          durationMins: f.durationMins,
        }))
        setParsedFlights(allFlights)
        setParsedFlight(result as unknown as Record<string, string>)
        // Set the manual form to the first flight as fallback
        setFlightForm({ ...allFlights[0], price: "" })
        toast.success(`Found ${result.flights.length} flight segment(s)!`)
      } else {
        setParsedFlights([])
        toast.error("Could not parse flight info -- fill in manually below")
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ""
      if (msg.includes("UPGRADE_REQUIRED")) {
        toast.error(msg.split(":").slice(1).join(":"))
      } else if (msg.includes("PARSE_FAILED")) {
        toast.error(msg.split(":").slice(1).join(":"))
      } else {
        toast.error("Failed to parse flight -- check API configuration in admin")
      }
    } finally {
      setParsingFlight(false)
    }
  }

  // Parse hotel from text
  async function handleParseHotel() {
    if (!hotelPasteText.trim()) return
    setParsingHotel(true)
    try {
      const result = await parseAndPreviewHotel(hotelPasteText)
      if (result && result.hotels && result.hotels.length > 0) {
        const h = result.hotels[0]
        const parsed = {
          name: h.name || "",
          address: h.address || "",
          checkIn: h.checkIn ? new Date(h.checkIn).toISOString().slice(0, 16) : "",
          checkOut: h.checkOut ? new Date(h.checkOut).toISOString().slice(0, 16) : "",
          confirmationNumber: h.confirmationNumber || result.confirmationNumber || "",
          price: h.price,
          priceCurrency: h.priceCurrency,
          roomCount: h.roomCount,
          roomType: h.roomType || "",
          isVacationRental: false,
        }
        setParsedHotel(parsed)
        toast.success("Hotel details parsed!")
      } else {
        toast.error("Could not parse hotel info -- fill in manually below")
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ""
      if (msg.includes("UPGRADE_REQUIRED")) {
        toast.error(msg.split(":").slice(1).join(":"))
      } else if (msg.includes("PARSE_FAILED")) {
        toast.error(msg.split(":").slice(1).join(":"))
      } else {
        toast.error("Failed to parse hotel -- check API configuration in admin")
      }
    } finally {
      setParsingHotel(false)
    }
  }

  async function handleAddParsedHotel() {
    if (!parsedHotel?.name || !parsedHotel?.checkIn || !parsedHotel?.checkOut) {
      toast.error("Name, check-in, and check-out dates are required")
      return
    }
    try {
      const hotel = await createHotel(tripId, {
        name: parsedHotel.name,
        address: parsedHotel.address || undefined,
        checkIn: new Date(parsedHotel.checkIn).toISOString(),
        checkOut: new Date(parsedHotel.checkOut).toISOString(),
        confirmationNumber: parsedHotel.confirmationNumber || undefined,
        isVacationRental: parsedHotel.isVacationRental || false,
        price: parsedHotel.price,
        priceCurrency: parsedHotel.priceCurrency,
        roomCount: parsedHotel.roomCount || 1,
        roomType: parsedHotel.roomType || undefined,
      })
      setTrip((prev) => ({ ...prev, hotels: [...prev.hotels, hotel as unknown as Trip["hotels"][0]] }))
      setParsedHotel(null)
      setHotelPasteText("")
      setShowHotelParse(false)
      toast.success("Hotel added!")
    } catch {
      toast.error("Failed to add hotel")
    }
  }

  function clearFlightState() {
    setShowFlightForm(false)
    setFlightPasteText("")
    setParsedFlight(null)
    setParsedFlights([])
    setFlightForm({ airline: "", flightNumber: "", departureAirport: "", departureTime: "", departureTimezone: "UTC", arrivalAirport: "", arrivalTime: "", arrivalTimezone: "UTC", confirmationNumber: "", cabin: "", price: "" })
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
      const created = await createFlightsBatch(tripId, batchData)
      setTrip((prev) => ({ ...prev, flights: [...prev.flights, ...(created as unknown as Trip["flights"])] }))
      clearFlightState()
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
        price: flightForm.price ? parseFloat(flightForm.price) : undefined,
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
        price: hotelForm.price ? parseFloat(hotelForm.price) : undefined,
        roomCount: hotelForm.roomCount ? parseInt(hotelForm.roomCount) : 1,
        roomType: hotelForm.roomType || undefined,
      })
      setTrip((prev) => ({ ...prev, hotels: [...prev.hotels, hotel as unknown as Trip["hotels"][0]] }))
      setShowHotelForm(false)
      setHotelForm({ name: "", address: "", checkIn: "", checkOut: "", confirmationNumber: "", bookingLink: "", isVacationRental: false, price: "", roomCount: "1", roomType: "" })
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

  // Parse rental car from text
  async function handleParseCar() {
    if (!carPasteText.trim()) return
    setParsingCar(true)
    try {
      const result = await parseAndPreviewRentalCar(carPasteText)
      if (result && result.rentalCars && result.rentalCars.length > 0) {
        const c = result.rentalCars[0]
        setParsedCar({
          company: c.company,
          vehicleType: c.vehicleType,
          pickupLocation: c.pickupLocation,
          pickupAddress: c.pickupAddress,
          pickupTime: c.pickupTime ? new Date(c.pickupTime).toISOString().slice(0, 16) : undefined,
          pickupTimezone: c.pickupTimezone,
          dropoffLocation: c.dropoffLocation,
          dropoffAddress: c.dropoffAddress,
          dropoffTime: c.dropoffTime ? new Date(c.dropoffTime).toISOString().slice(0, 16) : undefined,
          dropoffTimezone: c.dropoffTimezone,
          confirmationNumber: c.confirmationNumber || result.confirmationNumber,
          price: c.price,
          priceCurrency: c.priceCurrency,
          bookingLink: c.bookingLink,
          notes: c.notes,
        })
        toast.success("Rental car details parsed!")
      } else {
        toast.error("Could not parse rental car info -- fill in manually below")
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ""
      if (msg.includes("UPGRADE_REQUIRED")) {
        toast.error(msg.split(":").slice(1).join(":"))
      } else if (msg.includes("PARSE_FAILED")) {
        toast.error(msg.split(":").slice(1).join(":"))
      } else {
        toast.error("Failed to parse rental car -- check API configuration in admin")
      }
    } finally {
      setParsingCar(false)
    }
  }

  async function handleAddParsedCar() {
    if (!parsedCar?.pickupTime || !parsedCar?.dropoffTime) {
      toast.error("Pickup and dropoff times are required")
      return
    }
    try {
      const car = await createRentalCar(tripId, {
        company: parsedCar.company || undefined,
        vehicleType: parsedCar.vehicleType || undefined,
        pickupLocation: parsedCar.pickupLocation || undefined,
        pickupAddress: parsedCar.pickupAddress || undefined,
        pickupTime: new Date(parsedCar.pickupTime).toISOString(),
        pickupTimezone: parsedCar.pickupTimezone || "UTC",
        dropoffLocation: parsedCar.dropoffLocation || undefined,
        dropoffAddress: parsedCar.dropoffAddress || undefined,
        dropoffTime: new Date(parsedCar.dropoffTime).toISOString(),
        dropoffTimezone: parsedCar.dropoffTimezone || "UTC",
        confirmationNumber: parsedCar.confirmationNumber || undefined,
        price: parsedCar.price,
        priceCurrency: parsedCar.priceCurrency,
        bookingLink: parsedCar.bookingLink || undefined,
        notes: parsedCar.notes || undefined,
      })
      setTrip((prev) => ({ ...prev, rentalCars: [...prev.rentalCars, car as unknown as Trip["rentalCars"][0]] }))
      setParsedCar(null)
      setCarPasteText("")
      setShowCarParse(false)
      toast.success("Rental car added!")
    } catch {
      toast.error("Failed to add rental car")
    }
  }

  async function handleAddCar() {
    if (!carForm.pickupTime || !carForm.dropoffTime) {
      toast.error("Pickup and dropoff times are required")
      return
    }
    const companyName = carForm.company === "__other__" ? carForm.companyOther : carForm.company
    try {
      const car = await createRentalCar(tripId, {
        company: companyName || undefined,
        vehicleType: carForm.vehicleType || undefined,
        pickupLocation: carForm.pickupLocation || undefined,
        pickupTime: new Date(carForm.pickupTime).toISOString(),
        pickupTimezone: carForm.pickupTimezone || "UTC",
        dropoffLocation: carForm.dropoffLocation || undefined,
        dropoffTime: new Date(carForm.dropoffTime).toISOString(),
        dropoffTimezone: carForm.dropoffTimezone || "UTC",
        confirmationNumber: carForm.confirmationNumber || undefined,
        bookingLink: carForm.bookingLink || undefined,
        price: carForm.price ? parseFloat(carForm.price) : undefined,
        notes: carForm.notes || undefined,
      })
      setTrip((prev) => ({ ...prev, rentalCars: [...prev.rentalCars, car as unknown as Trip["rentalCars"][0]] }))
      setShowCarForm(false)
      setCarForm({ company: "", companyOther: "", vehicleType: "", pickupLocation: "", pickupTime: "", pickupTimezone: "UTC", dropoffLocation: "", dropoffTime: "", dropoffTimezone: "UTC", confirmationNumber: "", bookingLink: "", price: "", notes: "" })
      toast.success("Rental car added!")
    } catch {
      toast.error("Failed to add rental car")
    }
  }

  async function handleDeleteCar(carId: string) {
    try {
      await deleteRentalCar(tripId, carId)
      setTrip((prev) => ({ ...prev, rentalCars: prev.rentalCars.filter((c) => c.id !== carId) }))
      toast.success("Rental car removed")
    } catch {
      toast.error("Failed to remove rental car")
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

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      await inviteCollaborator(tripId, inviteEmail.trim(), inviteRole)
      setCollaborators((prev) => [
        ...prev,
        {
          id: "temp-" + Date.now(),
          email: inviteEmail.trim().toLowerCase(),
          role: inviteRole,
          status: "PENDING",
          user: null,
        },
      ])
      setInviteEmail("")
      setInviteRole("VIEWER")
      toast.success("Invite sent!")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to invite"
      toast.error(msg)
    } finally {
      setInviting(false)
    }
  }

  async function handleRemoveCollaborator(collaboratorId: string) {
    try {
      await removeCollaborator(tripId, collaboratorId)
      setCollaborators((prev) => prev.filter((c) => c.id !== collaboratorId))
      toast.success("Collaborator removed")
    } catch {
      toast.error("Failed to remove collaborator")
    }
  }

  async function handleChangeRole(collaboratorId: string, role: "VIEWER" | "EDITOR") {
    try {
      await updateCollaboratorRole(tripId, collaboratorId, role)
      setCollaborators((prev) =>
        prev.map((c) => (c.id === collaboratorId ? { ...c, role } : c))
      )
      toast.success("Role updated")
    } catch {
      toast.error("Failed to update role")
    }
  }

  const shareUrl = trip.shareSlug ? `${typeof window !== "undefined" ? window.location.origin : ""}/shared/${trip.shareSlug}` : ""

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Trip Settings</h1>

      {/* Tabs - scrollable on mobile */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-8 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-1 min-w-[80px] py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap",
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
          {userId && (
            <div className="mb-4">
              <ForwardingEmail userId={userId} variant="compact" />
            </div>
          )}
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
                <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                  <Plane className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-900 truncate">
                    {flight.flightNumber || "Flight"} · {flight.departureAirport} &rarr; {flight.arrivalAirport}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {formatDate(flight.departureTime, "MMM d, h:mm a")} &rarr;{" "}
                    {formatDate(flight.arrivalTime, "MMM d, h:mm a")}
                    {flight.confirmationNumber && ` · ${flight.confirmationNumber}`}
                    {flight.cabin && ` · ${flight.cabin}`}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteFlight(flight.id)}
                  className="p-2 text-gray-400 hover:text-red-500 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Rental car affiliate link when flights exist */}
          {trip.flights.length > 0 && carRentalLink && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl">
              <p className="text-xs text-gray-500 mb-2">Need a car at your destination?</p>
              <AffiliateBadge link={carRentalLink} />
            </div>
          )}

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
                <button onClick={clearFlightState} className="p-2">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>

              {/* Paste & parse */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Paste confirmation email (optional -- auto-parses)
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
                        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-100 rounded-xl flex-wrap"
                      >
                        <Plane className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                        <span className="text-sm text-gray-900 font-medium">
                          {f.flightNumber || "Flight"}
                        </span>
                        <span className="text-sm text-gray-500">
                          {f.departureAirport || "???"} &rarr; {f.arrivalAirport || "???"}
                        </span>
                        {f.departureTime && (
                          <span className="text-xs text-gray-400 sm:ml-auto">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Ticket price ($)</label>
                    <input type="number" placeholder="0.00" value={flightForm.price}
                      onChange={(e) => setFlightForm((f) => ({ ...f, price: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      min="0" step="0.01" />
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
          {userId && (
            <div className="mb-4">
              <ForwardingEmail userId={userId} variant="compact" />
            </div>
          )}
          {/* Booking.com affiliate suggestion */}
          {hotelAffiliateLink && (
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-4">
              <div className="flex items-start gap-3">
                <span className="text-xl">🏨</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-blue-900">Need a place to stay?</p>
                  <p className="text-xs text-blue-700 mt-0.5">Find hotels in {trip.destination} for your trip</p>
                  <a
                    href={hotelAffiliateLink.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      try { localStorage.setItem("jp_affiliate_click", JSON.stringify({ type: "hotel", tripId, timestamp: Date.now() })) } catch {}
                    }}
                    className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    Search on Booking.com →
                  </a>
                </div>
              </div>
            </div>
          )}

          {trip.hotels.length === 0 && !showHotelForm && !showHotelParse && (
            <div className="text-center py-12">
              <Hotel className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No hotels added yet</p>
            </div>
          )}

          <div className="space-y-2 mb-4">
            {trip.hotels.map((hotel) => (
              <div key={hotel.id} className="bg-white border border-gray-100 rounded-2xl p-4 group">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center shrink-0">
                    <Hotel className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900 truncate">
                      {hotel.isVacationRental ? "\u{1F3E1} " : "\u{1F3E8} "}{hotel.name}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {formatDate(hotel.checkIn, "MMM d")} &rarr; {formatDate(hotel.checkOut, "MMM d, yyyy")}
                      {hotel.confirmationNumber && ` \u00B7 ${hotel.confirmationNumber}`}
                      {hotel.address && ` \u00B7 ${hotel.address}`}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteHotel(hotel.id)}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {hotelAffiliateLink && (
                  <div className="mt-2 ml-12">
                    <AffiliateBadge link={hotelAffiliateLink} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Paste hotel confirmation (collapsible) */}
          {!showHotelForm && (
            <div className="mb-4">
              <button
                onClick={() => setShowHotelParse(!showHotelParse)}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 transition-colors p-2 -ml-2"
              >
                <ChevronDown className={cn("w-4 h-4 transition-transform", showHotelParse && "rotate-180")} />
                Paste hotel confirmation
              </button>

              {showHotelParse && (
                <div className="bg-white border border-gray-200 rounded-2xl p-4 mt-2">
                  <textarea
                    value={hotelPasteText}
                    onChange={(e) => setHotelPasteText(e.target.value)}
                    rows={4}
                    placeholder="Paste your hotel confirmation email here..."
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono text-xs"
                  />
                  <button
                    onClick={handleParseHotel}
                    disabled={parsingHotel || !hotelPasteText.trim()}
                    className="mt-2 flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
                  >
                    <Clipboard className="w-3.5 h-3.5" />
                    {parsingHotel ? "Parsing..." : "Parse hotel info"}
                  </button>

                  {/* Parsed hotel preview */}
                  {parsedHotel && (
                    <div className="mt-4 bg-purple-50 border border-purple-100 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <span className="text-sm font-medium text-gray-900">Hotel details parsed</span>
                      </div>
                      <div className="space-y-1 text-sm text-gray-700 mb-3">
                        {parsedHotel.name && <div><span className="text-gray-500">Name:</span> {parsedHotel.name}</div>}
                        {parsedHotel.address && <div><span className="text-gray-500">Address:</span> {parsedHotel.address}</div>}
                        {parsedHotel.checkIn && <div><span className="text-gray-500">Check-in:</span> {new Date(parsedHotel.checkIn).toLocaleDateString()}</div>}
                        {parsedHotel.checkOut && <div><span className="text-gray-500">Check-out:</span> {new Date(parsedHotel.checkOut).toLocaleDateString()}</div>}
                        {parsedHotel.confirmationNumber && <div><span className="text-gray-500">Confirmation:</span> {parsedHotel.confirmationNumber}</div>}
                        {parsedHotel.price !== undefined && <div><span className="text-gray-500">Price/night:</span> ${parsedHotel.price}</div>}
                        {parsedHotel.roomType && <div><span className="text-gray-500">Room:</span> {parsedHotel.roomType}</div>}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setParsedHotel(null); setHotelPasteText("") }}
                          className="flex-1 py-2 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50"
                        >
                          Discard
                        </button>
                        <button
                          onClick={handleAddParsedHotel}
                          className="flex-1 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700"
                        >
                          Add hotel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
                <button onClick={() => setShowHotelForm(false)} className="p-2">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="text" placeholder="Confirmation #" value={hotelForm.confirmationNumber}
                    onChange={(e) => setHotelForm((f) => ({ ...f, confirmationNumber: e.target.value }))}
                    className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
                  <input type="url" placeholder="Booking link" value={hotelForm.bookingLink}
                    onChange={(e) => setHotelForm((f) => ({ ...f, bookingLink: e.target.value }))}
                    className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Price per night ($)</label>
                    <input type="number" placeholder="0.00" value={hotelForm.price}
                      onChange={(e) => setHotelForm((f) => ({ ...f, price: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      min="0" step="0.01" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Number of rooms</label>
                    <input type="number" value={hotelForm.roomCount}
                      onChange={(e) => setHotelForm((f) => ({ ...f, roomCount: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      min="1" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Room type</label>
                    <input type="text" placeholder="2 Queen Beds" value={hotelForm.roomType}
                      onChange={(e) => setHotelForm((f) => ({ ...f, roomType: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 p-1">
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

      {/* CARS TAB */}
      {activeTab === "Cars" && (
        <div>
          {userId && (
            <div className="mb-4">
              <ForwardingEmail userId={userId} variant="compact" />
            </div>
          )}
          {/* Booking.com affiliate suggestion */}
          {carRentalLink && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 mb-4">
              <div className="flex items-start gap-3">
                <span className="text-xl">🚗</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-900">Don&apos;t have a rental car yet?</p>
                  <p className="text-xs text-emerald-700 mt-0.5">Find the best deals for your trip to {trip.destination}</p>
                  <a
                    href={carRentalLink.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      try { localStorage.setItem("jp_affiliate_click", JSON.stringify({ type: "car", tripId, timestamp: Date.now() })) } catch {}
                    }}
                    className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
                  >
                    Book on Booking.com →
                  </a>
                </div>
              </div>
            </div>
          )}

          {trip.rentalCars.length === 0 && !showCarForm && !showCarParse && (
            <div className="text-center py-12">
              <Car className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No rental cars added yet</p>
              <p className="text-gray-400 text-xs mt-1">
                Paste a confirmation email to auto-import, or add manually
              </p>
            </div>
          )}

          {/* Rental car list */}
          <div className="space-y-2 mb-4">
            {trip.rentalCars.map((car) => {
              const info = getCompanyInfo(car.company || "")
              return (
                <div key={car.id} className="bg-white border border-gray-100 rounded-2xl p-4 group">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm"
                      style={{ backgroundColor: info.color + "15" }}
                    >
                      <span>{info.logo}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900 truncate">
                        {car.company || "Rental Car"}{car.vehicleType ? ` \u00B7 ${car.vehicleType}` : ""}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {car.pickupLocation || "Pickup"} {"\u2192"} {car.dropoffLocation || "Dropoff"}
                        {" \u00B7 "}
                        {formatDate(car.pickupTime, "MMM d")} {"\u2192"} {formatDate(car.dropoffTime, "MMM d")}
                        {car.confirmationNumber && ` \u00B7 ${car.confirmationNumber}`}
                        {car.price != null && ` \u00B7 $${car.price}`}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteCar(car.id)}
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Paste rental car confirmation (collapsible) */}
          {!showCarForm && (
            <div className="mb-4">
              <button
                onClick={() => setShowCarParse(!showCarParse)}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 transition-colors p-2 -ml-2"
              >
                <ChevronDown className={cn("w-4 h-4 transition-transform", showCarParse && "rotate-180")} />
                Paste rental car confirmation
              </button>

              {showCarParse && (
                <div className="bg-white border border-gray-200 rounded-2xl p-4 mt-2">
                  <textarea
                    value={carPasteText}
                    onChange={(e) => setCarPasteText(e.target.value)}
                    rows={4}
                    placeholder="Paste your rental car confirmation email here..."
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono text-xs"
                  />
                  <button
                    onClick={handleParseCar}
                    disabled={parsingCar || !carPasteText.trim()}
                    className="mt-2 flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
                  >
                    <Clipboard className="w-3.5 h-3.5" />
                    {parsingCar ? "Parsing..." : "Parse rental car info"}
                  </button>

                  {/* Parsed car preview */}
                  {parsedCar && (
                    <div className="mt-4 bg-green-50 border border-green-100 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <span className="text-sm font-medium text-gray-900">Rental car details parsed</span>
                      </div>
                      <div className="space-y-1 text-sm text-gray-700 mb-3">
                        {parsedCar.company && <div><span className="text-gray-500">Company:</span> {parsedCar.company}</div>}
                        {parsedCar.vehicleType && <div><span className="text-gray-500">Vehicle:</span> {parsedCar.vehicleType}</div>}
                        {parsedCar.pickupLocation && <div><span className="text-gray-500">Pickup:</span> {parsedCar.pickupLocation}</div>}
                        {parsedCar.pickupTime && <div><span className="text-gray-500">Pickup time:</span> {new Date(parsedCar.pickupTime).toLocaleString()}</div>}
                        {parsedCar.dropoffLocation && <div><span className="text-gray-500">Dropoff:</span> {parsedCar.dropoffLocation}</div>}
                        {parsedCar.dropoffTime && <div><span className="text-gray-500">Dropoff time:</span> {new Date(parsedCar.dropoffTime).toLocaleString()}</div>}
                        {parsedCar.confirmationNumber && <div><span className="text-gray-500">Confirmation:</span> {parsedCar.confirmationNumber}</div>}
                        {parsedCar.price !== undefined && <div><span className="text-gray-500">Price:</span> ${parsedCar.price}</div>}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setParsedCar(null); setCarPasteText("") }}
                          className="flex-1 py-2 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50"
                        >
                          Discard
                        </button>
                        <button
                          onClick={handleAddParsedCar}
                          className="flex-1 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700"
                        >
                          Add rental car
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!showCarForm && (
            <button
              onClick={() => setShowCarForm(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add rental car
            </button>
          )}

          {showCarForm && (
            <div className="bg-white border border-indigo-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Add Rental Car</h3>
                <button onClick={() => setShowCarForm(false)} className="p-2">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Company</label>
                    <select
                      value={carForm.company}
                      onChange={(e) => setCarForm((f) => ({ ...f, company: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      <option value="">Select company...</option>
                      {Object.entries(RENTAL_CAR_COMPANIES).map(([key, val]) => (
                        <option key={key} value={val.name}>{val.logo} {val.name}</option>
                      ))}
                      <option value="__other__">Other...</option>
                    </select>
                  </div>
                  {carForm.company === "__other__" && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Company name</label>
                      <input type="text" placeholder="Company name" value={carForm.companyOther}
                        onChange={(e) => setCarForm((f) => ({ ...f, companyOther: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Vehicle type</label>
                    <input type="text" placeholder="Midsize SUV, Tesla Model 3..." value={carForm.vehicleType}
                      onChange={(e) => setCarForm((f) => ({ ...f, vehicleType: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Pickup location</label>
                    <input type="text" placeholder="Airport, city, address..." value={carForm.pickupLocation}
                      onChange={(e) => setCarForm((f) => ({ ...f, pickupLocation: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Pickup time *</label>
                    <input type="datetime-local" value={carForm.pickupTime}
                      onChange={(e) => setCarForm((f) => ({ ...f, pickupTime: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Dropoff location</label>
                    <input type="text" placeholder="Airport, city, address..." value={carForm.dropoffLocation}
                      onChange={(e) => setCarForm((f) => ({ ...f, dropoffLocation: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Dropoff time *</label>
                    <input type="datetime-local" value={carForm.dropoffTime}
                      onChange={(e) => setCarForm((f) => ({ ...f, dropoffTime: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Confirmation #</label>
                    <input type="text" placeholder="ABC123" value={carForm.confirmationNumber}
                      onChange={(e) => setCarForm((f) => ({ ...f, confirmationNumber: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Price (total $)</label>
                    <input type="number" placeholder="0.00" value={carForm.price}
                      onChange={(e) => setCarForm((f) => ({ ...f, price: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      min="0" step="0.01" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Booking link</label>
                    <input type="url" placeholder="https://..." value={carForm.bookingLink}
                      onChange={(e) => setCarForm((f) => ({ ...f, bookingLink: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Notes</label>
                  <textarea value={carForm.notes}
                    onChange={(e) => setCarForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    placeholder="Insurance details, special requests..."
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                </div>
                <div className="flex gap-3 pt-1">
                  <button onClick={() => setShowCarForm(false)}
                    className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50">
                    Cancel
                  </button>
                  <button onClick={handleAddCar}
                    className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700">
                    Add rental car
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
                  <TravelerCard
                    key={profile.id}
                    profile={profile}
                    added={added}
                    tripId={tripId}
                    onToggle={() => handleToggleTraveler(profile.id, added)}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* SHARING TAB */}
      {activeTab === "Sharing" && (
        <div className="space-y-6">
          {/* Owner */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Trip Owner</h3>
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center text-sm font-semibold text-indigo-700 shrink-0">
                <Crown className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-900">{ownerName || "You"}</div>
                {ownerEmail && <div className="text-xs text-gray-500">{ownerEmail}</div>}
              </div>
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">
                Owner
              </span>
            </div>
          </div>

          {/* Invite form - only for owner */}
          {isOwner && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h3 className="font-semibold text-gray-900 mb-1">Invite Collaborators</h3>
              <p className="text-sm text-gray-500 mb-4">
                Share this trip with others so they can view or help edit.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <input
                    type="email"
                    placeholder="Email address"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "VIEWER" | "EDITOR")}
                  className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="VIEWER">Viewer</option>
                  <option value="EDITOR">Editor</option>
                </select>
                <button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <UserPlus className="w-4 h-4" />
                  {inviting ? "Inviting..." : "Invite"}
                </button>
              </div>
            </div>
          )}

          {/* Collaborators list */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h3 className="font-semibold text-gray-900 mb-4">
              Collaborators {collaborators.length > 0 && `(${collaborators.length})`}
            </h3>
            {collaborators.length === 0 ? (
              <div className="text-center py-8">
                <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No collaborators yet</p>
                <p className="text-gray-400 text-xs mt-1">
                  Invite someone to view or edit this trip
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {collaborators.map((collab) => (
                  <div
                    key={collab.id}
                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl group"
                  >
                    <div className="w-9 h-9 bg-gray-200 rounded-full flex items-center justify-center text-sm font-semibold text-gray-600 shrink-0">
                      {collab.user?.name
                        ? collab.user.name.charAt(0).toUpperCase()
                        : <Mail className="w-4 h-4 text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900 truncate">
                        {collab.user?.name || collab.email}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {collab.user?.name ? collab.email : ""}
                        {collab.status === "PENDING" && (
                          <span className="ml-1 text-amber-600">(pending)</span>
                        )}
                        {collab.status === "DECLINED" && (
                          <span className="ml-1 text-red-500">(declined)</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isOwner ? (
                        <select
                          value={collab.role}
                          onChange={(e) =>
                            handleChangeRole(collab.id, e.target.value as "VIEWER" | "EDITOR")
                          }
                          className="px-2 py-1 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                        >
                          <option value="VIEWER">Viewer</option>
                          <option value="EDITOR">Editor</option>
                        </select>
                      ) : (
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full",
                          collab.role === "EDITOR"
                            ? "bg-green-50 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        )}>
                          {collab.role === "EDITOR" ? <Pencil className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          {collab.role === "EDITOR" ? "Editor" : "Viewer"}
                        </span>
                      )}
                      {isOwner && (
                        <button
                          onClick={() => handleRemoveCollaborator(collab.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
                      <span className="flex-1 text-sm text-gray-900 truncate">{dest.name}</span>
                      <button
                        onClick={() => handleRemoveDestination(dest.id)}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
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
                      className="w-full pl-8 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      apiKey={placesApiKey}
                    />
                  </div>
                  <button
                    onClick={handleAddDestination}
                    disabled={addingDestination || !newDestinationName.trim()}
                    className="px-3 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  className="flex-1 bg-transparent text-sm text-green-800 font-mono outline-none min-w-0 truncate"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(shareUrl)
                    toast.success("Link copied!")
                  }}
                  className="p-2 text-green-600 hover:text-green-800 transition-colors shrink-0"
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
