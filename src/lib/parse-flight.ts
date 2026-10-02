import { downsample, greatCircle } from "./geo";
import type {
  AirportStop,
  FlightSnapshot,
  FlightStatus,
  LatLon,
  TimeSet,
} from "./types";

export class FlightNotFoundError extends Error {
  constructor(message = "FlightAware doesn't have that flight right now.") {
    super(message);
    this.name = "FlightNotFoundError";
  }
}

type Raw = Record<string, unknown>;

function record(value: unknown): Raw | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Raw;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function unix(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value > 1e12 ? Math.round(value / 1000) : Math.round(value);
}

function timeSet(value: unknown): TimeSet {
  const raw = record(value);
  return {
    scheduled: unix(raw?.scheduled),
    estimated: unix(raw?.estimated),
    actual: unix(raw?.actual),
  };
}

function timeZone(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const zone = raw.replace(/^:/, "");
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return null;
  }
}

function latLonPair(value: unknown): LatLon | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = value[0];
  const lat = value[1];
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function airport(value: unknown): AirportStop {
  const raw = record(value);
  const point = latLonPair(raw?.coord);
  const iata = text(raw?.iata);
  const icao = text(raw?.icao);
  return {
    code: iata || icao || "—",
    name: text(raw?.friendlyName) || "Unknown airport",
    location: text(raw?.friendlyLocation) || "",
    lat: point?.lat ?? null,
    lon: point?.lon ?? null,
    terminal: text(raw?.terminal),
    gate: text(raw?.gate),
    timeZone: timeZone(raw?.TZ),
  };
}

function best(times: TimeSet): number | null {
  return times.actual ?? times.estimated ?? times.scheduled;
}

const STATUS_LABEL: Record<FlightStatus, string> = {
  scheduled: "Scheduled",
  taxiing: "Taxiing",
  enroute: "En route",
  arrived: "Arrived",
  cancelled: "Cancelled",
  diverted: "Diverted",
  unknown: "Status unknown",
};

function statusOf(flight: Raw, arrival: TimeSet, landing: TimeSet, departure: TimeSet, takeoff: TimeSet): FlightStatus {
  const label = (text(flight.flightStatus) || "").toLowerCase();
  if (flight.cancelled === true || label.includes("cancel")) return "cancelled";
  if (flight.diverted === true || label.includes("divert")) return "diverted";
  if (label.includes("arriv") || arrival.actual != null || landing.actual != null) return "arrived";
  if (label.includes("taxi") || (departure.actual != null && takeoff.actual == null)) return "taxiing";
  if (
    label.includes("en route") ||
    label.includes("enroute") ||
    (takeoff.actual != null && landing.actual == null)
  ) {
    return "enroute";
  }
  if (latLonPair(flight.coord) && landing.actual == null && arrival.actual == null) return "enroute";
  if (!text(flight.flightStatus) && best(departure) == null && best(arrival) == null) return "unknown";
  return "scheduled";
}

function routeOf(waypoints: unknown, origin: AirportStop, destination: AirportStop): LatLon[] {
  const filed = Array.isArray(waypoints)
    ? downsample(
        waypoints
          .map((point) => latLonPair(point))
          .filter((point): point is LatLon => point != null),
        180,
      )
    : [];
  if (filed.length >= 2) return filed;
  if (origin.lat != null && origin.lon != null && destination.lat != null && destination.lon != null) {
    return greatCircle({ lat: origin.lat, lon: origin.lon }, { lat: destination.lat, lon: destination.lon });
  }
  return filed;
}

function trackOf(value: unknown): { points: LatLon[]; last: Raw | null } {
  if (!Array.isArray(value)) return { points: [], last: null };
  const points: LatLon[] = [];
  let last: Raw | null = null;
  for (const entry of value) {
    const raw = record(entry);
    const point = latLonPair(raw?.coord);
    if (!point) continue;
    points.push(point);
    last = raw;
  }
  return { points: downsample(points, 280), last };
}

function chooseFlight(data: unknown): Raw {
  const root = record(data);
  const flights = record(root?.flights);
  if (!flights) throw new FlightNotFoundError();
  const real = Object.values(flights)
    .map((flight) => record(flight))
    .filter((flight): flight is Raw => flight != null && typeof flight.ident === "string");
  if (!real.length) throw new FlightNotFoundError();
  return real.find((flight) => flight.historical !== true) ?? real[0];
}

export function parseTrackpoll(data: unknown, fetchedAt = new Date().toISOString()): FlightSnapshot {
  const flight = chooseFlight(data);
  const origin = airport(flight.origin);
  const destination = airport(flight.destination);
  const departure = timeSet(flight.gateDepartureTimes);
  const takeoff = timeSet(flight.takeoffTimes);
  const landing = timeSet(flight.landingTimes);
  const arrival = timeSet(flight.gateArrivalTimes);
  const status = statusOf(flight, arrival, landing, departure, takeoff);

  const scheduled = arrival.scheduled ?? landing.scheduled;
  const compared = arrival.actual ?? arrival.estimated ?? landing.actual ?? landing.estimated;
  const delayMinutes =
    scheduled != null && compared != null ? Math.round((compared - scheduled) / 60) : null;
  const statusText = (text(flight.flightStatus) || "").toLowerCase();
  const delayed =
    status !== "cancelled" &&
    (statusText.includes("delay") || (delayMinutes != null && delayMinutes >= 5));
  const early = status !== "cancelled" && delayMinutes != null && delayMinutes <= -5;

  const { points: track, last } = trackOf(flight.track);
  const live = latLonPair(flight.coord);
  const moving = status === "enroute" || status === "taxiing";
  const positionPoint = live ?? (moving ? (track.at(-1) ?? null) : null);
  const altitudeFt =
    typeof flight.altitude === "number"
      ? flight.altitude
      : typeof last?.alt === "number"
        ? last.alt
        : null;
  const groundspeedKt =
    typeof flight.groundspeed === "number"
      ? flight.groundspeed
      : typeof last?.gs === "number"
        ? last.gs
        : null;
  const heading = typeof flight.heading === "number" ? flight.heading : null;

  const airlineRaw = record(flight.airline);
  const ident = text(flight.iataIdent) || text(flight.ident) || "Flight";
  const callsign = text(flight.ident) || ident;
  const links = record(flight.links);
  const permanent = text(links?.permanent);
  const flightAwareUrl = permanent
    ? permanent.startsWith("http")
      ? permanent
      : `https://www.flightaware.com${permanent.startsWith("/") ? permanent : `/${permanent}`}`
    : `https://www.flightaware.com/live/flight/${encodeURIComponent(callsign)}`;

  const aircraftRaw = record(flight.aircraft);

  return {
    ident,
    callsign,
    friendlyName: text(flight.friendlyIdent) || ident,
    airline: text(airlineRaw?.shortName) || text(airlineRaw?.fullName),
    aircraft: text(aircraftRaw?.friendlyType),
    status,
    statusLabel: STATUS_LABEL[status],
    delayed,
    early,
    delayMinutes,
    origin,
    destination,
    departure,
    arrival: {
      scheduled: arrival.scheduled ?? landing.scheduled,
      estimated: arrival.estimated ?? landing.estimated,
      actual: arrival.actual ?? landing.actual,
    },
    arrivalIsGate: arrival.scheduled != null || arrival.estimated != null || arrival.actual != null,
    landing,
    position:
      positionPoint && moving
        ? {
            lat: positionPoint.lat,
            lon: positionPoint.lon,
            altitudeFt: moving ? altitudeFt : null,
            groundspeedKt: moving ? groundspeedKt : null,
            heading,
          }
        : null,
    track,
    route: routeOf(flight.waypoints, origin, destination),
    flightAwareUrl,
    fetchedAt,
  };
}
