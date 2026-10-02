export type TerminalPlace = {
  name: string;
  ref: string | null;
  lat: number | null;
  lon: number | null;
};

const GENERIC = new Set([
  "INTERNATIONAL",
  "DOMESTIC",
  "MAIN",
  "CENTRAL",
  "NORTH",
  "SOUTH",
  "EAST",
  "WEST",
  "NEW",
  "OLD",
  "CONCOURSE",
  "TERMINAL",
  "HALL",
]);

/** OpenStreetMap terminal buildings and concourses, kept local so a lookup does not wait on Overpass. */
const KNOWN_PLACES: TerminalPlace[] = [
  { name: "A Concourse", ref: null, lat: 42.2085823, lon: -83.357856 },
  { name: "B Concourse", ref: null, lat: 42.208343, lon: -83.362498 },
  { name: "C Concourse", ref: null, lat: 42.210771, lon: -83.3607074 },
  { name: "D Concourse", ref: null, lat: 42.2260828, lon: -83.3488325 },
  { name: "McNamara Terminal", ref: null, lat: 42.207924, lon: -83.3565806 },
  { name: "Warren Cleage Evans Terminal", ref: null, lat: 42.2256094, lon: -83.3482903 },
];

function compact(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isConcourse(place: TerminalPlace) {
  return /concourse/i.test(place.name);
}

function isBuilding(place: TerminalPlace) {
  return /terminal/i.test(place.name) && !isConcourse(place);
}

function matchesCode(place: TerminalPlace, code: string) {
  const ref = compact(place.ref ?? "");
  if (ref && (ref === code || ref === `T${code}`)) return true;
  const name = compact(place.name);
  return (
    name === code ||
    name === `TERMINAL${code}` ||
    name === `${code}TERMINAL` ||
    name === `CONCOURSE${code}` ||
    name === `${code}CONCOURSE`
  );
}

function redundant(code: string, label: string) {
  const name = compact(label);
  return (
    name === code ||
    name === `TERMINAL${code}` ||
    name === `${code}TERMINAL` ||
    name === `CONCOURSE${code}` ||
    name === `${code}CONCOURSE`
  );
}

export function commonTerminalName(name: string) {
  const parts = name.replace(/\s+/g, " ").trim().split(" ");
  if (parts.length >= 3 && /^terminal$/i.test(parts[parts.length - 1] ?? "")) {
    const previous = (parts[parts.length - 2] ?? "").replace(/[^A-Za-z]/g, "");
    if (previous && !GENERIC.has(previous.toUpperCase())) return `${previous} Terminal`;
    if (parts.length >= 4) {
      const given = (parts[parts.length - 3] ?? "").replace(/\.$/, "");
      return `${given} ${parts[parts.length - 2]} Terminal`;
    }
  }
  return parts.join(" ");
}

function distance(a: TerminalPlace, b: TerminalPlace) {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return Number.POSITIVE_INFINITY;
  const dy = a.lat - b.lat;
  const dx = (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180);
  return dx * dx + dy * dy;
}

function nearestBuilding(anchor: TerminalPlace, places: TerminalPlace[]) {
  let best: TerminalPlace | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const place of places) {
    if (!isBuilding(place)) continue;
    const gap = distance(anchor, place);
    if (gap < bestDistance) {
      best = place;
      bestDistance = gap;
    }
  }
  return best;
}

function named(place: TerminalPlace, code: string) {
  const label = commonTerminalName(place.name);
  return redundant(code, label) ? null : label;
}

function gateLetter(gate: string | null) {
  return (gate ?? "").toUpperCase().match(/[A-Z]/)?.[0] ?? null;
}

export function matchTerminalName(code: string | null, gate: string | null, places: TerminalPlace[]) {
  const normalized = compact(code ?? "");
  if (!normalized) return null;
  const usable = places.filter((place) => place.name.trim());

  const direct = usable.filter((place) => matchesCode(place, normalized));
  const directBuilding = direct.find(isBuilding);
  if (directBuilding) return named(directBuilding, normalized);
  const directConcourse = direct.find(isConcourse);
  if (directConcourse) {
    const building = nearestBuilding(directConcourse, usable);
    if (building) {
      const label = named(building, normalized);
      if (label) return label;
    }
    return named(directConcourse, normalized);
  }

  if (normalized.length === 1) {
    const hits = usable.filter((place) => {
      if (!isBuilding(place)) return false;
      return place.name.split(/\s+/).some((word) => {
        const letters = word.replace(/[^A-Za-z]/g, "");
        return letters.length > 1 && !GENERIC.has(letters.toUpperCase()) && letters[0]?.toUpperCase() === normalized;
      });
    });
    if (hits.length === 1) return named(hits[0], normalized);
  }

  const letter = gateLetter(gate);
  if (!letter) return null;
  const concourse = usable.find((place) => isConcourse(place) && matchesCode(place, letter));
  if (!concourse) return null;
  const building = nearestBuilding(concourse, usable);
  return building ? named(building, normalized) : null;
}

function nearbyPlaces(lat: number, lon: number) {
  const latWindow = 8 / 111;
  const lonWindow = 8 / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return KNOWN_PLACES.filter((place) => {
    if (place.lat == null || place.lon == null) return false;
    return Math.abs(place.lat - lat) <= latWindow && Math.abs(place.lon - lon) <= lonWindow;
  });
}

export function resolveTerminalName(stop: {
  terminal: string | null;
  gate: string | null;
  lat: number | null;
  lon: number | null;
}) {
  if (!stop.terminal || stop.lat == null || stop.lon == null) return null;
  return matchTerminalName(stop.terminal, stop.gate, nearbyPlaces(stop.lat, stop.lon));
}
