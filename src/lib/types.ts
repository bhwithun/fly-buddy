export type TimeSet = {
  scheduled: number | null;
  estimated: number | null;
  actual: number | null;
};

export type AirportStop = {
  code: string;
  name: string;
  location: string;
  lat: number | null;
  lon: number | null;
  terminal: string | null;
  /** Common building name, such as Evans Terminal, when it differs from the code. */
  terminalName: string | null;
  gate: string | null;
  timeZone: string | null;
};

export type LatLon = {
  lat: number;
  lon: number;
};

export type FlightStatus =
  | "scheduled"
  | "taxiing"
  | "enroute"
  | "arrived"
  | "cancelled"
  | "diverted"
  | "unknown";

export type FlightSnapshot = {
  ident: string;
  callsign: string;
  friendlyName: string;
  airline: string | null;
  aircraft: string | null;
  status: FlightStatus;
  statusLabel: string;
  delayed: boolean;
  early: boolean;
  delayMinutes: number | null;
  origin: AirportStop;
  destination: AirportStop;
  departure: TimeSet;
  /** Gate arrival when FlightAware has it, otherwise wheels-on time. */
  arrival: TimeSet;
  arrivalIsGate: boolean;
  landing: TimeSet;
  position: {
    lat: number;
    lon: number;
    altitudeFt: number | null;
    groundspeedKt: number | null;
    heading: number | null;
  } | null;
  track: LatLon[];
  route: LatLon[];
  flightAwareUrl: string;
  fetchedAt: string;
};

export type DriveEstimate = {
  label: string;
  durationSeconds: number;
  distanceMeters: number;
};
