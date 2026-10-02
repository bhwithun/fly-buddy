import { NextResponse } from "next/server";
import { cleanIdent, lookupFlight } from "@/lib/flightaware";
import { FlightNotFoundError } from "@/lib/parse-flight";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ident = cleanIdent(searchParams.get("ident") ?? "");
  if (ident.length < 2) {
    return NextResponse.json(
      { error: "Enter a flight number, like WN4546." },
      { status: 400 },
    );
  }

  try {
    const flight = await lookupFlight(ident, searchParams.get("fresh") === "1");
    return NextResponse.json(
      { flight },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof FlightNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Couldn't look up that flight.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
