"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { formatAgo, formatClock, formatDay, formatFeet, formatMiles, formatSpan, formatUntil, timeZoneName } from "@/lib/format";
import { fraunces } from "@/lib/fonts";
import { MEET_BUFFERS, arrivalInstant, normalizeBuffer, planLeave, type MeetBuffer } from "@/lib/leave";
import type { DriveEstimate, FlightSnapshot } from "@/lib/types";

const ADDRESS_KEY = "fly-buddy.address";
const BUFFER_KEY = "fly-buddy.buffer";

function MapFallback() {
  return <div className="map-frame h-64 animate-pulse sm:h-72" aria-hidden="true" />;
}

const RouteMap = dynamic(
  () => import("@/components/route-map").then((mod) => mod.RouteMap),
  { ssr: false, loading: MapFallback },
);

const storageListeners = new Set<() => void>();

function subscribeStorage(callback: () => void) {
  storageListeners.add(callback);
  return () => {
    storageListeners.delete(callback);
  };
}

function emitStorage() {
  for (const listener of storageListeners) listener();
}

function readStorage(key: string, fallback: string) {
  const stored = window.localStorage.getItem(key);
  return stored == null || stored === "" ? fallback : stored;
}

function useStored(key: string, fallback: string) {
  const value = useSyncExternalStore(
    subscribeStorage,
    () => readStorage(key, fallback),
    () => fallback,
  );
  const setValue = useCallback(
    (next: string) => {
      if (next) window.localStorage.setItem(key, next);
      else window.localStorage.removeItem(key);
      emitStorage();
    },
    [key],
  );
  return [value, setValue] as const;
}

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export function Tracker() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(() => (searchParams.get("flight") ?? "").toUpperCase());
  const [flight, setFlight] = useState<FlightSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [savedAddress, setSavedAddress] = useStored(ADDRESS_KEY, "");
  const [bufferValue, setBufferValue] = useStored(BUFFER_KEY, "20");
  const [draft, setDraft] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const addressField = draft ?? savedAddress;
  const [driveResult, setDriveResult] = useState<{
    key: string;
    drive: DriveEstimate | null;
    error: string | null;
  } | null>(null);
  const [driveNonce, setDriveNonce] = useState(0);
  const initialIdent = useRef(searchParams.get("flight"));

  const buffer = normalizeBuffer(Number(bufferValue));

  const loadFlight = useCallback(
    async (ident: string, quiet = false) => {
      const clean = ident.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
      if (clean.length < 2) {
        setError("Enter a flight number, like WN4546.");
        return;
      }
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
      try {
        const response = await fetch(`/api/flight?ident=${clean}${quiet ? "" : "&fresh=1"}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(await readError(response, "Couldn't look up that flight."));
        }
        const body = (await response.json()) as { flight: FlightSnapshot };
        setFlight(body.flight);
        setQuery(clean);
        setUpdatedAt(Date.now());
        setRefreshNote(null);
        router.replace(`/?flight=${clean}`, { scroll: false });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Couldn't look up that flight.";
        if (quiet) setRefreshNote(message);
        else {
          setFlight(null);
          setError(message);
        }
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    const ident = initialIdent.current;
    if (!ident) return;
    const timer = window.setTimeout(() => {
      void loadFlight(ident);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFlight]);

  useEffect(() => {
    if (!flight) return;
    const id = window.setInterval(() => {
      void loadFlight(flight.ident, true);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [flight, loadFlight]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const destLat = flight?.destination.lat ?? null;
  const destLon = flight?.destination.lon ?? null;
  const driveKey =
    savedAddress.trim() && destLat != null && destLon != null
      ? `${savedAddress.trim()}|${destLat}|${destLon}|${driveNonce}`
      : null;
  const drive = driveResult?.key === driveKey ? driveResult.drive : null;
  const driveError = driveResult?.key === driveKey ? driveResult.error : null;
  const driveLoading = driveKey != null && driveResult?.key !== driveKey;

  useEffect(() => {
    if (!driveKey || destLat == null || destLon == null) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      address: savedAddress.trim(),
      lat: String(destLat),
      lon: String(destLon),
    });
    void fetch(`/api/drive?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, "Couldn't estimate the drive."));
        return (await response.json()) as { drive: DriveEstimate };
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setDriveResult({ key: driveKey, drive: body.drive, error: null });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setDriveResult({
          key: driveKey,
          drive: null,
          error: caught instanceof Error ? caught.message : "Couldn't estimate the drive.",
        });
      });
    return () => controller.abort();
  }, [destLat, destLon, driveKey, savedAddress]);

  function onTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadFlight(query);
  }

  function onAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = addressField.trim();
    if (next.length < 3) {
      setAddressError("Enter a starting address.");
      return;
    }
    setAddressError(null);
    setSavedAddress(next);
    setDriveNonce((value) => value + 1);
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center gap-3 pt-2">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-card ring-1 ring-line" aria-hidden="true">
          <PlaneMark />
        </span>
        <div>
          <p className={`${fraunces.className} text-2xl leading-none text-cream`}>fly-buddy</p>
          <p className="mt-1 text-sm text-muted">When to leave for the airport</p>
        </div>
      </header>

      <form onSubmit={onTrack} className="space-y-2">
        <label htmlFor="flight" className="px-1 text-sm text-muted">
          Flight number
        </label>
        <div className="flex gap-2">
          <input
            id="flight"
            name="flight"
            value={query}
            onChange={(event) => setQuery(event.target.value.toUpperCase())}
            placeholder="WN4546"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-card px-4 text-base tracking-wide text-cream outline-none placeholder:text-muted/70"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-12 shrink-0 rounded-2xl bg-amber px-5 text-base font-semibold text-ink disabled:opacity-60"
          >
            {loading ? "Looking…" : "Track"}
          </button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="rounded-2xl bg-late/10 px-4 py-3 text-sm text-late">
          {error}
        </p>
      ) : null}

      {flight ? (
        <div className="flex flex-col gap-6" aria-live="polite">
          <FlightSummary flight={flight} now={now} />
          <Pickup
            flight={flight}
            now={now}
            buffer={buffer}
            onBuffer={(minutes) => setBufferValue(String(minutes))}
            draft={addressField}
            onDraft={setDraft}
            onAddress={onAddress}
            drive={drive}
            driveError={addressError ?? driveError}
            driveLoading={driveLoading}
          />
          <RouteMap flight={flight} />
          <div className="flex items-center justify-between gap-3 px-1 text-xs text-muted">
            <button
              type="button"
              onClick={() => void loadFlight(flight.ident)}
              className="min-w-0 truncate text-left text-xs text-muted"
            >
              {updatedAt ? `Updated ${formatAgo(updatedAt, now)}` : "Updated"}
              {refreshNote ? ` · ${refreshNote}` : ""}. Tap to refresh
            </button>
            <a
              href={flight.flightAwareUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 font-medium text-amber-2"
            >
              FlightAware
            </a>
          </div>
        </div>
      ) : (
        !error && (
          <p className="px-1 text-sm leading-6 text-muted">
            Type a flight number. I&apos;ll show the airports, the arrival gate, and when you should head out.
          </p>
        )
      )}
    </main>
  );
}

function PlaneMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 22h24" stroke="#f0b429" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 19.5 16 6l10 13.5h-5.2L16 13.2 11.2 19.5Z" fill="#f4f0e6" />
    </svg>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: "sky" | "late" | "early" | "quiet" | "amber";
  children: ReactNode;
}) {
  const tones = {
    sky: "bg-sky/15 text-sky",
    late: "bg-late/15 text-late",
    early: "bg-early/15 text-early",
    quiet: "bg-white/10 text-muted",
    amber: "bg-amber/15 text-amber-2",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function FlightSummary({ flight, now }: { flight: FlightSnapshot; now: number }) {
  const zone = flight.destination.timeZone;
  const when = arrivalInstant(flight.arrival);
  const airportClock = when ? formatClock(when, zone) : null;
  const localClock = when ? formatClock(when) : null;
  const zoneLabel = when ? timeZoneName(when, zone) : "";
  const departAt = flight.departure.actual ?? flight.departure.estimated ?? flight.departure.scheduled;
  const departed = flight.departure.actual != null;
  const tone = flight.status === "cancelled" || flight.status === "diverted"
    ? "late"
    : flight.status === "enroute" || flight.status === "taxiing"
      ? "sky"
      : flight.status === "arrived"
        ? "early"
        : "quiet";
  const headline = flight.status === "arrived" ? "Arrived" : flight.arrival.actual ? "Arrived" : "Arrives";
  const speed = flight.position?.groundspeedKt;
  const altitude = flight.position?.altitudeFt;

  return (
    <section className="rounded-[1.75rem] border border-line bg-card px-4 py-5 shadow-[0_20px_50px_rgb(0_0_0/0.25)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-wide text-cream">{flight.ident}</h1>
          <p className="text-sm text-muted">{flight.friendlyName}</p>
        </div>
        <Chip tone={tone}>{flight.statusLabel}</Chip>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        <Airport code={flight.origin.code} name={flight.origin.name} place={flight.origin.location} />
        <span className="px-1 pt-1 text-amber" aria-hidden="true">
          →
        </span>
        <Airport code={flight.destination.code} name={flight.destination.name} place={flight.destination.location} align="end" />
      </div>

      {departAt ? (
        <p className="mt-3 text-sm text-muted">
          {departed ? "Left" : "Leaves"} {formatClock(departAt, flight.origin.timeZone)}{" "}
          {timeZoneName(departAt, flight.origin.timeZone)}
          {flight.aircraft ? ` · ${flight.aircraft}` : ""}
        </p>
      ) : null}

      <div className="mt-5 border-t border-line pt-5">
        <p className="text-sm text-muted">{headline}{flight.arrivalIsGate ? "" : " (runway)"}</p>
        <p className={`${fraunces.className} mt-1 text-5xl leading-none tracking-tight text-cream`}>
          {airportClock ?? "—"}
        </p>
        {when ? (
          <p className="mt-2 text-sm text-muted">
            {formatDay(when, zone)}
            {zoneLabel ? ` · ${zoneLabel}` : ""}
            {` · ${formatUntil(when, now)}`}
            {localClock && localClock !== airportClock ? ` · ${localClock} your time` : ""}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">Arrival time isn&apos;t posted yet.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {flight.delayed && flight.delayMinutes != null ? (
            <Chip tone="late">{Math.abs(flight.delayMinutes)} min late</Chip>
          ) : null}
          {flight.early && flight.delayMinutes != null ? (
            <Chip tone="early">{Math.abs(flight.delayMinutes)} min early</Chip>
          ) : null}
          {flight.arrival.scheduled && flight.delayMinutes != null && Math.abs(flight.delayMinutes) >= 5 ? (
            <Chip tone="quiet">Scheduled {formatClock(flight.arrival.scheduled, zone)}</Chip>
          ) : null}
        </div>
        {(speed != null || altitude != null) && (
          <p className="mt-3 text-sm text-sky">
            {[altitude != null ? formatFeet(altitude) : null, speed != null ? `${Math.round(speed)} kt` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3">
        <Info label="Terminal" value={flight.destination.terminal} />
        <Info label="Gate" value={flight.destination.gate} />
      </dl>
    </section>
  );
}

function Airport({
  code,
  name,
  place,
  align = "start",
}: {
  code: string;
  name: string;
  place: string;
  align?: "start" | "end";
}) {
  const end = align === "end";
  return (
    <div className={end ? "min-w-0 text-right" : "min-w-0 text-left"}>
      <p className={`${fraunces.className} text-3xl leading-none text-cream`}>{code}</p>
      <p className="mt-1 text-balance text-sm leading-5 text-cream/90">{name}</p>
      {place ? <p className="text-xs text-muted">{place}</p> : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-2xl bg-card-2 px-3 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`${fraunces.className} mt-1 text-2xl text-cream`}>{value || "Not posted"}</dd>
    </div>
  );
}

function Pickup({
  flight,
  now,
  buffer,
  onBuffer,
  draft,
  onDraft,
  onAddress,
  drive,
  driveError,
  driveLoading,
}: {
  flight: FlightSnapshot;
  now: number;
  buffer: MeetBuffer;
  onBuffer: (minutes: MeetBuffer) => void;
  draft: string;
  onDraft: (value: string) => void;
  onAddress: (event: FormEvent<HTMLFormElement>) => void;
  drive: DriveEstimate | null;
  driveError: string | null;
  driveLoading: boolean;
}) {
  const arrival = arrivalInstant(flight.arrival);
  const plan = arrival != null && drive
    ? planLeave({
        arrivalUnix: arrival,
        driveSeconds: drive.durationSeconds,
        bufferMinutes: buffer,
        nowUnix: Math.floor(now / 1000),
      })
    : null;
  const airport = flight.destination.code;

  return (
    <section className="rounded-[1.75rem] border border-line bg-card px-4 py-5">
      <h2 className="text-sm font-medium text-cream">Pickup</h2>
      <p className="mt-1 text-sm leading-5 text-muted">
        A typical drive to {airport}, plus time for them to reach the curb. This is not live traffic.
      </p>

      <fieldset className="mt-4">
        <legend className="text-xs text-muted">Be at the curb after arrival</legend>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {MEET_BUFFERS.map((minutes) => (
            <label
              key={minutes}
              className={`flex h-10 items-center justify-center rounded-xl border text-sm ${
                buffer === minutes
                  ? "border-amber bg-amber/15 text-amber-2"
                  : "border-line bg-card-2 text-muted"
              }`}
            >
              <input
                type="radio"
                name="meet-buffer"
                value={minutes}
                checked={buffer === minutes}
                onChange={() => onBuffer(minutes)}
                className="sr-only"
              />
              {minutes}m
            </label>
          ))}
        </div>
      </fieldset>

      {flight.status === "cancelled" ? (
        <p className="mt-4 text-sm text-late">This flight is cancelled, so there is no pickup time.</p>
      ) : plan && drive ? (
        <div className="mt-4">
          <p className="text-sm text-muted">{plan.leaveNow ? "Leave now" : "Leave by"}</p>
          <p className={`${fraunces.className} mt-1 text-4xl leading-none text-amber-2`}>
            {plan.leaveNow ? "Now" : formatClock(plan.leaveUnix)}
          </p>
          <p className="mt-2 text-sm leading-5 text-muted">
            {formatSpan(drive.durationSeconds)} · {formatMiles(drive.distanceMeters)} to {airport}.
            {plan.leaveNow
              ? plan.lateBySeconds > 60
                ? ` You'll get there about ${formatSpan(plan.lateBySeconds)} after the meet time.`
                : " You'll still make the meet time if you go now."
              : ` Reach the curb about ${buffer} min after ${formatClock(plan.arrivalUnix, flight.destination.timeZone)}.`}
          </p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">From {drive.label}</p>
        </div>
      ) : arrival == null ? (
        <p className="mt-4 text-sm text-muted">I need an arrival time before I can say when to leave.</p>
      ) : null}

      <form onSubmit={onAddress} className="mt-4 space-y-2">
        <label htmlFor="address" className="px-1 text-xs text-muted">
          Starting address
        </label>
        <input
          id="address"
          name="address"
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          placeholder="123 Main St, Detroit"
          autoComplete="street-address"
          enterKeyHint="go"
          className="h-12 w-full rounded-2xl border border-line bg-card-2 px-4 text-base text-cream outline-none placeholder:text-muted/70"
        />
        <button
          type="submit"
          disabled={driveLoading}
          className="h-11 w-full rounded-2xl bg-cream text-sm font-semibold text-ink disabled:opacity-60"
        >
          {driveLoading ? "Estimating…" : drive ? "Update drive" : "Estimate drive"}
        </button>
      </form>
      {driveError ? (
        <p role="alert" className="mt-3 text-sm text-late">
          {driveError}
        </p>
      ) : null}
    </section>
  );
}
