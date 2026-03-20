import { haversineDistance } from "./haversine"

// Average CO2 emissions per passenger per km by flight distance
// Source: ICAO Carbon Emissions Calculator methodology
function getEmissionFactor(distanceKm: number): number {
  if (distanceKm < 500) return 0.255 // short haul
  if (distanceKm < 1500) return 0.156 // medium haul
  if (distanceKm < 4000) return 0.15 // long haul
  return 0.147 // ultra long haul
}

// Major airport coordinates for CO2 calculation
const AIRPORT_COORDS: Record<string, [number, number]> = {
  // US Major
  JFK: [40.6413, -73.7781],
  LAX: [33.9416, -118.4085],
  ORD: [41.9742, -87.9073],
  ATL: [33.6407, -84.4277],
  DFW: [32.8998, -97.0403],
  SFO: [37.6213, -122.379],
  SEA: [47.4502, -122.3088],
  MIA: [25.7959, -80.287],
  DEN: [39.8561, -104.6737],
  BOS: [42.3656, -71.0096],
  IAH: [29.9902, -95.3368],
  MSP: [44.8848, -93.2223],
  DTW: [42.2124, -83.3534],
  PHL: [39.8729, -75.2437],
  LGA: [40.7769, -73.874],
  EWR: [40.6895, -74.1745],
  CLT: [35.214, -80.9431],
  PHX: [33.4373, -112.0078],
  SAN: [32.7338, -117.1933],
  AUS: [30.1975, -97.6664],
  SAT: [29.5337, -98.4698],
  GRR: [42.8808, -85.5228],
  IAD: [38.9531, -77.4565],
  DCA: [38.8512, -77.0402],
  MCO: [28.4312, -81.308],
  BWI: [39.1754, -76.6684],
  SLC: [40.7884, -111.9778],
  PDX: [45.5898, -122.5951],
  BNA: [36.1263, -86.6774],
  RDU: [35.8776, -78.7875],
  // International
  LHR: [51.47, -0.4543],
  CDG: [49.0097, 2.5479],
  FRA: [50.0379, 8.5622],
  AMS: [52.3086, 4.7639],
  NRT: [35.7647, 140.3864],
  HND: [35.5494, 139.7798],
  SYD: [-33.9461, 151.1772],
  MEL: [-37.6733, 144.8433],
  FCO: [41.8003, 12.2389],
  MAD: [40.4936, -3.5668],
  BCN: [41.2971, 2.0785],
  MUC: [48.3538, 11.786],
  DUB: [53.4213, -6.2701],
  IST: [41.2753, 28.7519],
  HKG: [22.308, 113.9185],
  SIN: [1.3644, 103.9915],
  ICN: [37.4602, 126.4407],
  PEK: [40.0799, 116.6031],
  DEL: [28.5562, 77.1],
  BOM: [19.0896, 72.8656],
  DXB: [25.2532, 55.3657],
  DOH: [25.2731, 51.6081],
  YYZ: [43.6777, -79.6248],
  YVR: [49.1939, -123.1844],
  GRU: [-23.4356, -46.4731],
  EZE: [-34.8222, -58.5358],
  MEX: [19.4363, -99.0721],
  CUN: [21.0365, -86.877],
  LIS: [38.7756, -9.1354],
  CPH: [55.618, 12.6508],
  OSL: [60.1976, 11.1004],
  ARN: [59.6519, 17.9186],
  HEL: [60.3172, 24.9633],
  ZRH: [47.4647, 8.5492],
  VIE: [48.1103, 16.5697],
  BRU: [50.9014, 4.4844],
  MAN: [53.3537, -2.275],
  EDI: [55.95, -3.3725],
  ATH: [37.9364, 23.9445],
  NBO: [-1.3192, 36.9278],
  JNB: [-26.1392, 28.246],
  CAI: [30.1219, 31.4056],
}

export interface CarbonFootprint {
  totalKgCO2: number
  flights: { route: string; distanceKm: number; kgCO2: number }[]
  equivalents: {
    treeDays: number // days of CO2 absorption by one tree
    carKm: number // equivalent km driven
    percentOfAnnual: number // % of avg annual per-capita emissions
  }
}

export function calculateTripCarbon(
  flights: { departureAirport?: string | null; arrivalAirport?: string | null }[]
): CarbonFootprint {
  const flightResults: CarbonFootprint["flights"] = []
  let totalKgCO2 = 0

  for (const f of flights) {
    if (!f.departureAirport || !f.arrivalAirport) continue
    const depCode = f.departureAirport.toUpperCase().trim()
    const arrCode = f.arrivalAirport.toUpperCase().trim()
    const dep = AIRPORT_COORDS[depCode]
    const arr = AIRPORT_COORDS[arrCode]
    if (!dep || !arr) continue

    const dist = haversineDistance(dep[0], dep[1], arr[0], arr[1])
    const kgCO2 = Math.round(dist * getEmissionFactor(dist))
    totalKgCO2 += kgCO2

    flightResults.push({
      route: `${depCode} → ${arrCode}`,
      distanceKm: Math.round(dist),
      kgCO2,
    })
  }

  return {
    totalKgCO2,
    flights: flightResults,
    equivalents: {
      treeDays: Math.round(totalKgCO2 / 0.06), // a tree absorbs ~22kg CO2/year = 0.06/day
      carKm: Math.round(totalKgCO2 / 0.21), // avg car emits 0.21 kg CO2/km
      percentOfAnnual: Math.round((totalKgCO2 / 4000) * 100), // avg person: ~4 tonnes/year
    },
  }
}
