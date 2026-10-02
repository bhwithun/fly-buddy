import { FlightNotFoundError, parseTrackpoll } from "./parse-flight";
import type { FlightSnapshot } from "./types";

const CACHE_MS = 20_000;
const cache = new Map<string, { at: number; flight: FlightSnapshot }>();

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

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
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": USER_AGENT,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("FlightAware request failed", reason);
    throw new Error("FlightAware didn't respond. Try again in a moment.");
  }

  if (!response.ok) {
    const snippet = (await response.text()).slice(0, 500).replace(/\s+/g, " ");
    console.error(
      "FlightAware request failed",
      response.status,
      response.headers.get("cf-ray"),
      response.headers.get("content-type"),
      snippet,
    );
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
