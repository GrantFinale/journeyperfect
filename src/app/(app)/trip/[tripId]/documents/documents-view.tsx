"use client"

import { useState } from "react"
import { toast } from "sonner"
import { createDocument, deleteDocument } from "@/lib/actions/documents"
import { cn } from "@/lib/utils"
import {
  FileText,
  Plus,
  Trash2,
  X,
  Copy,
  ExternalLink,
  Plane,
  Hotel,
  CreditCard,
  Shield,
  Car,
  Passport,
} from "lucide-react"

type Document = {
  id: string
  type: string
  title: string
  fileUrl: string | null
  externalLink: string | null
  confirmationCode: string | null
  notes: string | null
  flightId: string | null
  hotelId: string | null
  flight: { flightNumber: string | null; departureAirport: string | null; arrivalAirport: string | null } | null
  hotel: { name: string } | null
}

type Flight = { id: string; flightNumber: string | null; departureAirport: string | null; arrivalAirport: string | null }
type HotelEntry = { id: string; name: string }

const DOC_TYPES = [
  "BOARDING_PASS",
  "HOTEL_CONFIRMATION",
  "VISA",
  "PASSPORT",
  "INSURANCE",
  "RENTAL_CAR",
  "OTHER",
] as const

type DocType = (typeof DOC_TYPES)[number]

const DOC_LABELS: Record<DocType, string> = {
  BOARDING_PASS: "Boarding Pass",
  HOTEL_CONFIRMATION: "Hotel Confirmation",
  VISA: "Visa",
  PASSPORT: "Passport",
  INSURANCE: "Travel Insurance",
  RENTAL_CAR: "Rental Car",
  OTHER: "Other",
}

const DOC_ICONS: Record<DocType, React.ReactNode> = {
  BOARDING_PASS: <Plane className="w-4 h-4" />,
  HOTEL_CONFIRMATION: <Hotel className="w-4 h-4" />,
  VISA: <CreditCard className="w-4 h-4" />,
  PASSPORT: <Passport className="w-4 h-4" />,
  INSURANCE: <Shield className="w-4 h-4" />,
  RENTAL_CAR: <Car className="w-4 h-4" />,
  OTHER: <FileText className="w-4 h-4" />,
}

const DOC_COLORS: Record<DocType, string> = {
  BOARDING_PASS: "bg-blue-50 text-blue-600",
  HOTEL_CONFIRMATION: "bg-purple-50 text-purple-600",
  VISA: "bg-green-50 text-green-600",
  PASSPORT: "bg-indigo-50 text-indigo-600",
  INSURANCE: "bg-teal-50 text-teal-600",
  RENTAL_CAR: "bg-orange-50 text-orange-600",
  OTHER: "bg-gray-50 text-gray-600",
}

interface Props {
  tripId: string
  initialDocuments: Document[]
  flights: Flight[]
  hotels: HotelEntry[]
}

// Passport icon substitute since lucide might not have it
function Passport(props: { className?: string }) {
  return <FileText {...props} />
}

export function DocumentsView({ tripId, initialDocuments, flights, hotels }: Props) {
  const [documents, setDocuments] = useState<Document[]>(initialDocuments)
  const [showForm, setShowForm] = useState(false)
  const [filterType, setFilterType] = useState<string>("ALL")
  const [form, setForm] = useState({
    type: "OTHER" as DocType,
    title: "",
    externalLink: "",
    confirmationCode: "",
    notes: "",
    flightId: "",
    hotelId: "",
  })

  const filtered = documents.filter((d) => filterType === "ALL" || d.type === filterType)

  async function handleAdd() {
    if (!form.title) {
      toast.error("Title is required")
      return
    }
    try {
      const doc = await createDocument(tripId, {
        type: form.type,
        title: form.title,
        externalLink: form.externalLink || undefined,
        confirmationCode: form.confirmationCode || undefined,
        notes: form.notes || undefined,
        flightId: form.flightId || undefined,
        hotelId: form.hotelId || undefined,
      })
      setDocuments((prev) => [doc as unknown as Document, ...prev])
      setShowForm(false)
      setForm({
        type: "OTHER",
        title: "",
        externalLink: "",
        confirmationCode: "",
        notes: "",
        flightId: "",
        hotelId: "",
      })
      toast.success("Document added")
    } catch {
      toast.error("Failed to add document")
    }
  }

  async function handleDelete(docId: string) {
    try {
      await deleteDocument(tripId, docId)
      setDocuments((prev) => prev.filter((d) => d.id !== docId))
      toast.success("Document removed")
    } catch {
      toast.error("Failed to remove document")
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code)
    toast.success("Confirmation code copied!")
  }

  // Grouped by type
  const grouped = DOC_TYPES.reduce(
    (acc, type) => {
      const docs = filtered.filter((d) => d.type === type)
      if (docs.length > 0) acc[type] = docs
      return acc
    },
    {} as Record<DocType, Document[]>
  )

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {documents.length} document{documents.length !== 1 ? "s" : ""} saved
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add document
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-white border border-indigo-200 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Add Document</h3>
            <button onClick={() => setShowForm(false)}>
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Document type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as DocType }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  {DOC_TYPES.map((t) => (
                    <option key={t} value={t}>{DOC_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Title *</label>
                <input
                  type="text"
                  placeholder="e.g. Delta Flight Confirmation"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <input
              type="text"
              placeholder="Confirmation / booking code"
              value={form.confirmationCode}
              onChange={(e) => setForm((f) => ({ ...f, confirmationCode: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
            <input
              type="url"
              placeholder="Link to document (booking site, PDF, etc.)"
              value={form.externalLink}
              onChange={(e) => setForm((f) => ({ ...f, externalLink: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {/* Link to flight or hotel */}
            {(form.type === "BOARDING_PASS") && flights.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Link to flight (optional)</label>
                <select
                  value={form.flightId}
                  onChange={(e) => setForm((f) => ({ ...f, flightId: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">No flight</option>
                  {flights.map((fl) => (
                    <option key={fl.id} value={fl.id}>
                      {fl.flightNumber} {fl.departureAirport} → {fl.arrivalAirport}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(form.type === "HOTEL_CONFIRMATION") && hotels.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Link to hotel (optional)</label>
                <select
                  value={form.hotelId}
                  onChange={(e) => setForm((f) => ({ ...f, hotelId: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">No hotel</option>
                  {hotels.map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </div>
            )}

            <textarea
              placeholder="Notes..."
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700"
              >
                Save document
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Type filter pills */}
      <div className="flex gap-1 flex-wrap mb-6">
        <button
          onClick={() => setFilterType("ALL")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
            filterType === "ALL" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          )}
        >
          All
        </button>
        {DOC_TYPES.filter((t) => documents.some((d) => d.type === t)).map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
              filterType === t ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {DOC_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {documents.length === 0 && (
        <div className="text-center py-16">
          <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No documents yet</p>
          <p className="text-gray-400 text-xs mt-1">
            Add boarding passes, hotel confirmations, visas, and more
          </p>
        </div>
      )}

      {/* Grouped document cards */}
      <div className="space-y-6">
        {Object.entries(grouped).map(([type, docs]) => (
          <div key={type}>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {DOC_LABELS[type as DocType]}
            </h2>
            <div className="space-y-2">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className="bg-white border border-gray-100 rounded-2xl p-4 group hover:border-gray-200 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                        DOC_COLORS[doc.type as DocType] || "bg-gray-50 text-gray-600"
                      )}
                    >
                      {DOC_ICONS[doc.type as DocType]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 text-sm">{doc.title}</div>
                      {doc.flight && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {doc.flight.flightNumber} · {doc.flight.departureAirport} → {doc.flight.arrivalAirport}
                        </div>
                      )}
                      {doc.hotel && (
                        <div className="text-xs text-gray-500 mt-0.5">{doc.hotel.name}</div>
                      )}
                      {doc.confirmationCode && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="font-mono text-sm bg-gray-50 text-gray-800 px-2.5 py-1 rounded-lg border border-gray-100 tracking-wider">
                            {doc.confirmationCode}
                          </span>
                          <button
                            onClick={() => copyCode(doc.confirmationCode!)}
                            className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors"
                            title="Copy code"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {doc.notes && (
                        <p className="text-xs text-gray-400 mt-1">{doc.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {doc.externalLink && (
                        <a
                          href={doc.externalLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
