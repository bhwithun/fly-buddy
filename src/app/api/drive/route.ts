import { NextResponse } from "next/server";

const USER_AGENT = "fly-buddy/1.0 (arrival pickup planner; contact: brian@brianandkathi.com)";

function numberInRange(value: string | null, min: number, max: number) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = (searchParams.get("address") ?? "").trim();
  const lat = numberInRange(searchParams.get("lat"), -90, 90);
  const lon = numberInRange(searchParams.get("lon"), -180, 180);

  if (address.length < 3 || address.length > 200) {
    return NextResponse.json(
      { error: "Enter a starting address." },
      { status: 400 },
    );
  }
  if (lat == null || lon == null) {
    return NextResponse.json(
      { error: "This airport doesn't have a map location yet, so I can't estimate the drive." },
      { status: 400 },
    );
  }

  let geoResponse: Response;
  try {
    const geoUrl = new URL("https://nominatim.openstreetmap.org/search");
    geoUrl.searchParams.set("format", "jsonv2");
    geoUrl.searchParams.set("limit", "1");
    geoUrl.searchParams.set("q", address);
    geoResponse = await fetch(geoUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
  } catch {
    return NextResponse.json(
      { error: "The address search didn't respond. Try again in a moment." },
      { status: 502 },
    );
  }

  if (!geoResponse.ok) {
    return NextResponse.json(
      { error: "The address search didn't respond. Try again in a moment." },
      { status: 502 },
    );
  }

  const places = (await geoResponse.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
  }>;
  const place = places[0];
  const originLat = place ? Number(place.lat) : NaN;
  const originLon = place ? Number(place.lon) : NaN;
  if (!place || !Number.isFinite(originLat) || !Number.isFinite(originLon)) {
    return NextResponse.json(
      { error: "I couldn't find that address. Try adding the city." },
      { status: 404 },
    );
  }

  let routeResponse: Response;
  try {
    const routeUrl = `https://router.project-osrm.org/route/v1/driving/${originLon},${originLat};${lon},${lat}?overview=false`;
    routeResponse = await fetch(routeUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": USER_AGENT },
    });
  } catch {
    return NextResponse.json(
      { error: "The drive estimate didn't respond. Try again in a moment." },
      { status: 502 },
    );
  }

  if (!routeResponse.ok) {
    return NextResponse.json(
      { error: "The drive estimate didn't respond. Try again in a moment." },
      { status: 502 },
    );
  }

  const route = (await routeResponse.json()) as {
    code?: string;
    routes?: Array<{ duration?: number; distance?: number }>;
  };
  const duration = route.routes?.[0]?.duration;
  const distance = route.routes?.[0]?.distance;
  if (route.code !== "Ok" || typeof duration !== "number" || typeof distance !== "number") {
    return NextResponse.json(
      { error: "I couldn't find a drive to the airport from there." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      drive: {
        label: place.display_name || address,
        durationSeconds: Math.round(duration / 60) * 60,
        distanceMeters: distance,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
