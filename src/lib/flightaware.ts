import { FlightNotFoundError, parseTrackpoll } from "./parse-flight";
import type { FlightSnapshot } from "./types";

const CACHE_MS = 20_000;
const cache = new Map<string, { at: number; flight: FlightSnapshot }>();

const USER_AGENT =
  "fly-buddy/1.0 (personal arrival tracker; +https://github.com/bhwithun/fly-buddy)";

export function cleanIdent(input: string) {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function readBootstrap(html: string) {
  const marker = "var trackpollBootstrap = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const end = html.indexOf("</script>", start);
  if (end < 0) return null;
  let raw = html.slice(start + marker.length, end).trim();
  if (raw.endsWith(";")) raw = raw.slice(0, -1);
  return JSON.parse(raw) as unknown;
}

export async function lookupFlight(ident: string, fresh = false): Promise<FlightSnapshot> {
  const cached = cache.get(ident);
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.flight;

  const url = `https://www.flightaware.com/ajax/ignoreall/omnisearch/disambiguation.rvt?searchterm=${encodeURIComponent(ident)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
      },
    });
  } catch {
    throw new Error("FlightAware didn't respond. Try again in a moment.");
  }

  if (!response.ok) {
    throw new Error("FlightAware didn't respond. Try again in a moment.");
  }

  const html = await response.text();
  let data: unknown;
  try {
    data = readBootstrap(html);
  } catch {
    throw new Error("FlightAware returned something I couldn't read.");
  }
  if (!data) throw new FlightNotFoundError();

  const flight = parseTrackpoll(data);
  cache.set(ident, { at: Date.now(), flight });
  return flight;
}
