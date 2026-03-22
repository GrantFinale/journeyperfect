"use client"

import { ExternalLink, MapPin } from "lucide-react"

const AIRPORT_MAPS: Record<string, { name: string; url: string }> = {
  JFK: { name: "John F. Kennedy Intl", url: "https://www.jfkairport.com/at-airport/airport-maps" },
  LAX: { name: "Los Angeles Intl", url: "https://www.flylax.com/lax-terminal-maps" },
  ORD: { name: "Chicago O'Hare Intl", url: "https://www.flychicago.com/ohare/map/pages/default.aspx" },
  ATL: { name: "Hartsfield-Jackson Atlanta", url: "https://www.atl.com/airport-maps/" },
  DFW: { name: "Dallas/Fort Worth Intl", url: "https://www.dfwairport.com/maps/" },
  SFO: { name: "San Francisco Intl", url: "https://www.flysfo.com/passengers/airport-maps" },
  DEN: { name: "Denver Intl", url: "https://www.flydenver.com/at-dia/maps-directions" },
  IAH: { name: "George Bush Intercontinental", url: "https://www.fly2houston.com/iah/maps" },
  AUS: { name: "Austin-Bergstrom Intl", url: "https://www.austintexas.gov/airport/terminal-map" },
  SAT: { name: "San Antonio Intl", url: "https://www.sanantonio.gov/SAT/Traveler-Information/Airport-Maps" },
  GRR: { name: "Gerald R. Ford Intl", url: "https://www.grr.org/terminal-map" },
  MIA: { name: "Miami Intl", url: "https://www.miami-airport.com/airport_maps.asp" },
  BOS: { name: "Boston Logan Intl", url: "https://www.massport.com/logan-airport/getting-around-logan/terminal-maps/" },
  SEA: { name: "Seattle-Tacoma Intl", url: "https://www.portseattle.org/sea-tac/maps-and-parking" },
  MSP: { name: "Minneapolis-St. Paul Intl", url: "https://www.mspairport.com/airport/terminal-maps" },
  DTW: { name: "Detroit Metro Wayne County", url: "https://www.metroairport.com/terminals/terminal-maps" },
  PHL: { name: "Philadelphia Intl", url: "https://www.phl.org/at-phl/terminal-maps" },
  LGA: { name: "LaGuardia", url: "https://www.laguardiaairport.com/at-airport/airport-maps" },
  EWR: { name: "Newark Liberty Intl", url: "https://www.newarkairport.com/at-airport/airport-maps" },
  CLT: { name: "Charlotte Douglas Intl", url: "https://www.cltairport.com/airport-map/" },
  PHX: { name: "Phoenix Sky Harbor Intl", url: "https://www.skyharbor.com/maps" },
  SAN: { name: "San Diego Intl", url: "https://www.san.org/at-the-airport/terminal-maps" },
  IAD: { name: "Washington Dulles Intl", url: "https://www.flydulles.com/iad/iad-airport-map" },
  DCA: { name: "Ronald Reagan Washington", url: "https://www.flyreagan.com/dca/dca-terminal-map" },
  MCO: { name: "Orlando Intl", url: "https://www.orlandoairports.net/getting-around/" },
  BWI: { name: "Baltimore/Washington Intl", url: "https://www.bwiairport.com/terminal-map" },
  SLC: { name: "Salt Lake City Intl", url: "https://www.slcairport.com/airport-guide/terminal-map/" },
  PDX: { name: "Portland Intl", url: "https://www.pdx.com/terminal-map" },
  BNA: { name: "Nashville Intl", url: "https://www.flynashville.com/at-the-airport/Pages/terminal-map.aspx" },
  RDU: { name: "Raleigh-Durham Intl", url: "https://www.rdu.com/terminal-map/" },
  FLL: { name: "Fort Lauderdale-Hollywood Intl", url: "https://www.broward.org/Airport/Passengers/Pages/TerminalMaps.aspx" },
  TPA: { name: "Tampa Intl", url: "https://www.tampaairport.com/airport-map" },
  HNL: { name: "Daniel K. Inouye Intl", url: "https://airports.hawaii.gov/hnl/terminal-map/" },
  STL: { name: "St. Louis Lambert Intl", url: "https://www.flystl.com/at-the-airport/terminal-map" },
  MCI: { name: "Kansas City Intl", url: "https://www.flykci.com/at-the-airport/terminal-map/" },
  LHR: { name: "London Heathrow", url: "https://www.heathrow.com/at-the-airport/airport-maps" },
  CDG: { name: "Paris Charles de Gaulle", url: "https://www.parisaeroport.fr/en/passengers/access/paris-charles-de-gaulle/terminal-maps" },
  FRA: { name: "Frankfurt", url: "https://www.frankfurt-airport.com/en/airport-guide/maps.html" },
  AMS: { name: "Amsterdam Schiphol", url: "https://www.schiphol.nl/en/at-schiphol/map/" },
  NRT: { name: "Tokyo Narita", url: "https://www.narita-airport.jp/en/map/" },
  HND: { name: "Tokyo Haneda", url: "https://tokyo-haneda.com/en/map/index.html" },
  SYD: { name: "Sydney Kingsford Smith", url: "https://www.sydneyairport.com.au/maps" },
  FCO: { name: "Rome Fiumicino", url: "https://www.adr.it/fiumicino-maps" },
  MAD: { name: "Madrid Barajas", url: "https://www.aena.es/en/madrid-barajas/airport-maps.html" },
  BCN: { name: "Barcelona El Prat", url: "https://www.aena.es/en/barcelona-el-prat/airport-maps.html" },
  MUC: { name: "Munich", url: "https://www.munich-airport.de/en/consumer/map" },
  DUB: { name: "Dublin", url: "https://www.dublinairport.com/at-the-airport/terminal-maps" },
  IST: { name: "Istanbul", url: "https://www.istairport.com/en/passenger/airport-guide/maps" },
  HKG: { name: "Hong Kong Intl", url: "https://www.hongkongairport.com/en/transport/airport-maps/" },
  SIN: { name: "Singapore Changi", url: "https://www.changiairport.com/en/airport-guide/terminal-maps.html" },
  ICN: { name: "Seoul Incheon", url: "https://www.airport.kr/ap/en/map/mapInfo.do" },
  DXB: { name: "Dubai Intl", url: "https://www.dubaiairports.ae/before-you-fly/terminal-maps" },
  DOH: { name: "Hamad Intl", url: "https://dohahamadairport.com/airport-guide/at-the-airport/airport-map" },
  YYZ: { name: "Toronto Pearson", url: "https://www.torontopearson.com/en/while-you-are-here/terminal-maps" },
  YVR: { name: "Vancouver Intl", url: "https://www.yvr.ca/en/passengers/navigate-yvr/maps" },
  MEX: { name: "Mexico City Intl", url: "https://www.aicm.com.mx/en/passengers/airport-maps" },
  CUN: { name: "Cancun Intl", url: "https://www.cancunairport.com/terminal-maps.html" },
  LIS: { name: "Lisbon Humberto Delgado", url: "https://www.aeroportolisboa.pt/en/lis/airport-guide/maps" },
  CPH: { name: "Copenhagen Kastrup", url: "https://www.cph.dk/en/practical/airport-map" },
  ZRH: { name: "Zurich", url: "https://www.flughafen-zuerich.ch/en/passengers/airport-map" },
}

interface AirportInfoProps {
  airportCode: string
  type: "departure" | "arrival"
  className?: string
}

export function AirportMapLink({ airportCode, className }: { airportCode: string; className?: string }) {
  const code = airportCode?.toUpperCase().trim()
  const airport = AIRPORT_MAPS[code]
  if (!airport) return null

  return (
    <a
      href={airport.url}
      target="_blank"
      rel="noopener noreferrer"
      className={className || "inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"}
    >
      <MapPin className="w-3 h-3" />
      Airport map
      <ExternalLink className="w-2.5 h-2.5" />
    </a>
  )
}

export function AirportInfo({ airportCode, type, className }: AirportInfoProps) {
  const code = airportCode?.toUpperCase().trim()
  const airport = AIRPORT_MAPS[code]

  if (!airport) return null

  return (
    <div className={className || "flex items-center gap-2 mt-1"}>
      <span className="text-xs text-gray-500">{airport.name}</span>
      <a
        href={airport.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
      >
        <MapPin className="w-3 h-3" />
        Terminal map
        <ExternalLink className="w-2.5 h-2.5" />
      </a>
    </div>
  )
}

export function getAirportMapUrl(code: string): string | null {
  return AIRPORT_MAPS[code?.toUpperCase().trim()]?.url ?? null
}

export { AIRPORT_MAPS }
