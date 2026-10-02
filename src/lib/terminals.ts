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

const placeCache = new Map<string, { at: number; places: TerminalPlace[] }>();
const PLACE_TTL_MS = 24 * 60 * 60 * 1000;

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

type OverpassElement = {
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
};

function placeFromElement(element: OverpassElement): TerminalPlace | null {
  const tags = element.tags ?? {};
  const name = tags.short_name || tags.name || tags.full_name || "";
  if (!name) return null;
  const lat = element.lat ?? element.center?.lat ?? null;
  const lon = element.lon ?? element.center?.lon ?? null;
  return {
    name,
    ref: tags.ref || tags["aeroway:ref"] || null,
    lat: typeof lat === "number" ? lat : null,
    lon: typeof lon === "number" ? lon : null,
  };
}

async function fetchPlaces(lat: number, lon: number) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = placeCache.get(key);
  if (cached && Date.now() - cached.at < PLACE_TTL_MS) return cached.places;

  const query = `[out:json][timeout:12];(node["aeroway"="terminal"](around:8000,${lat},${lon});way["aeroway"="terminal"](around:8000,${lat},${lon});relation["aeroway"="terminal"](around:8000,${lat},${lon}););out center tags;`;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "fly-buddy/1.0 (arrival pickup planner; contact: brian@brianandkathi.com)",
    },
    body: new URLSearchParams({ data: query }),
  });
  if (!response.ok) throw new Error(`terminal lookup ${response.status}`);
  const body = (await response.json()) as { elements?: OverpassElement[] };
  const places = (body.elements ?? []).flatMap((element) => {
    const place = placeFromElement(element);
    return place ? [place] : [];
  });
  placeCache.set(key, { at: Date.now(), places });
  return places;
}

export async function resolveTerminalName(stop: {
  terminal: string | null;
  gate: string | null;
  lat: number | null;
  lon: number | null;
}) {
  if (!stop.terminal || stop.lat == null || stop.lon == null) return null;
  try {
    const places = await fetchPlaces(stop.lat, stop.lon);
    return matchTerminalName(stop.terminal, stop.gate, places);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("Terminal name lookup failed", reason);
    return null;
  }
}
