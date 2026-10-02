"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { cleanIdent } from "@/lib/flightaware";
import { formatAgo, formatClock, formatDay, formatFeet, formatMiles, formatSpan, formatUntil, timeZoneName } from "@/lib/format";
import { fraunces } from "@/lib/fonts";
import { EARLY_BUFFERS, MEET_BUFFERS, arrivalInstant, formatLead, normalizeBuffer, normalizeEarly, planDropoff, planLeave, type EarlyBuffer, type MeetBuffer } from "@/lib/leave";
import { ADDRESS_COOKIE, BUFFER_COOKIE, EARLY_COOKIE, FLIGHT_COOKIE, MODE_COOKIE, readCookie, writeCookie } from "@/lib/prefs";
import type { DriveEstimate, FlightSnapshot } from "@/lib/types";

const REFRESH_MS = 5 * 60 * 1000;
const LEGACY_ADDRESS_KEY = "fly-buddy.address";
const LEGACY_BUFFER_KEY = "fly-buddy.buffer";

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

function readStorage(key: string) {
  const stored = window.localStorage.getItem(key);
  return stored == null || stored === "" ? "" : stored;
}

function useCookie(name: string, serverValue: string) {
  const value = useSyncExternalStore(
    subscribeStorage,
    () => readCookie(name) ?? "",
    () => serverValue,
  );
  const setValue = useCallback(
    (next: string) => {
      writeCookie(name, next);
      emitStorage();
    },
    [name],
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

type TripMode = "pickup" | "dropoff";
type PickupTab = "flight" | "departure" | "arrival" | "pickup" | "route";

const PICKUP_TABS: { id: PickupTab; label: string }[] = [
  { id: "flight", label: "Flight" },
  { id: "departure", label: "Departure" },
  { id: "arrival", label: "Arrival" },
  { id: "pickup", label: "Pickup" },
  { id: "route", label: "Route" },
];

function tripMode(value: string | null | undefined): TripMode {
  return value === "dropoff" ? "dropoff" : "pickup";
}

export function Tracker({
  initialFlight,
  initialAddress,
  initialBuffer,
  initialEarly,
  initialMode,
}: {
  initialFlight: string;
  initialAddress: string;
  initialBuffer: string;
  initialEarly: string;
  initialMode: TripMode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rememberedFlight = cleanIdent(searchParams.get("flight") || initialFlight);
  const startingMode = tripMode(searchParams.get("mode") || initialMode);
  const [query, setQuery] = useState(rememberedFlight);
  const [purpose, setPurpose] = useState<TripMode>(startingMode);
  const purposeRef = useRef<TripMode>(startingMode);
  const [flight, setFlight] = useState<FlightSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [savedAddress, setSavedAddress] = useCookie(ADDRESS_COOKIE, initialAddress);
  const [bufferValue, setBufferValue] = useCookie(BUFFER_COOKIE, initialBuffer);
  const [earlyValue, setEarlyValue] = useCookie(EARLY_COOKIE, initialEarly);
  const [draft, setDraft] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const addressField = draft ?? savedAddress;
  const [driveResult, setDriveResult] = useState<{
    key: string;
    drive: DriveEstimate | null;
    error: string | null;
  } | null>(null);
  const [driveNonce, setDriveNonce] = useState(0);
  const [pickupTab, setPickupTab] = useState<PickupTab>("flight");
  const initialIdent = useRef(rememberedFlight);
  const lookupGen = useRef(0);

  const buffer = normalizeBuffer(Number(bufferValue));
  const early = normalizeEarly(Number(earlyValue));

  const loadFlight = useCallback(
    async (ident: string, mode: "search" | "poll" = "search") => {
      const clean = cleanIdent(ident);
      if (clean.length < 2) {
        setError("Enter a flight number, like WN4546.");
        return;
      }
      const quiet = mode === "poll";
      const generation = ++lookupGen.current;
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
      try {
        const response = await fetch(`/api/flight?ident=${clean}&fresh=1`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(await readError(response, "Couldn't look up that flight."));
        }
        const body = (await response.json()) as { flight: FlightSnapshot };
        if (lookupGen.current !== generation) return;
        setFlight(body.flight);
        if (!quiet) setPickupTab("flight");
        setQuery(clean);
        setUpdatedAt(Date.now());
        setRefreshNote(null);
        writeCookie(FLIGHT_COOKIE, clean);
        writeCookie(MODE_COOKIE, purposeRef.current);
        router.replace(`/?flight=${clean}&mode=${purposeRef.current}`, { scroll: false });
      } catch (caught) {
        if (lookupGen.current !== generation) return;
        const message = caught instanceof Error ? caught.message : "Couldn't look up that flight.";
        if (quiet) setRefreshNote(message);
        else {
          setFlight(null);
          setError(message);
        }
      } finally {
        if (!quiet && lookupGen.current === generation) setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    let changed = false;
    if (!readCookie(ADDRESS_COOKIE)) {
      const legacy = readStorage(LEGACY_ADDRESS_KEY);
      if (legacy) {
        writeCookie(ADDRESS_COOKIE, legacy);
        changed = true;
      }
    }
    if (!readCookie(BUFFER_COOKIE)) {
      const legacy = readStorage(LEGACY_BUFFER_KEY);
      if (legacy) {
        writeCookie(BUFFER_COOKIE, legacy);
        changed = true;
      }
    }
    if (changed) emitStorage();
  }, []);

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
      setDriveNonce((value) => value + 1);
      void loadFlight(flight.ident, "poll");
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [flight, loadFlight]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const driveAirport = purpose === "dropoff" ? flight?.origin : flight?.destination;
  const destLat = driveAirport?.lat ?? null;
  const destLon = driveAirport?.lon ?? null;
  const driveKey =
    savedAddress.trim() && destLat != null && destLon != null
      ? `${purpose}|${savedAddress.trim()}|${destLat}|${destLon}|${driveNonce}`
      : null;
  const driveCurrent = driveResult != null && driveResult.key === driveKey;
  const driveSameTrip =
    driveResult != null && driveKey != null && tripOf(driveResult.key) === tripOf(driveKey);
  const drive = driveCurrent ? driveResult.drive : driveSameTrip ? driveResult.drive : null;
  const driveError = driveCurrent ? driveResult.error : null;
  const driveLoading = driveKey != null && !driveCurrent;

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

  function onChoose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flight || loading) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const selected = submitter instanceof HTMLButtonElement ? submitter.value : "";
    const next = selected === "dropoff" ? "dropoff" : "pickup";
    purposeRef.current = next;
    setPurpose(next);
    void loadFlight(query);
  }

  function onClear() {
    lookupGen.current += 1;
    setFlight(null);
    setError(null);
    setRefreshNote(null);
    setUpdatedAt(null);
    setQuery("");
    setLoading(false);
    writeCookie(FLIGHT_COOKIE, "");
    router.replace("/", { scroll: false });
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

      <div className="space-y-2">
        <form onSubmit={onChoose} className="space-y-2">
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
            {flight || loading ? (
              <button
                type="button"
                onClick={onClear}
                className="h-12 shrink-0 rounded-2xl border border-line bg-card-2 px-5 text-base font-semibold text-cream"
              >
                Clear
              </button>
            ) : null}
          </div>
          {flight || loading ? null : (
            <div className="grid grid-cols-2 gap-2">
              <ModeButton purpose="pickup" disabled={loading}>
                Pickup
              </ModeButton>
              <ModeButton purpose="dropoff" disabled={loading}>
                Dropoff
              </ModeButton>
            </div>
          )}
        </form>
        {loading && !flight ? <p className="px-1 text-sm text-muted">Looking up {cleanIdent(query)}…</p> : null}
        {flight ? (
          <p className="px-1 text-sm text-muted">
            {purpose === "dropoff"
              ? "Departure and leave-by update every 5 minutes."
              : "Arrival and leave-by update every 5 minutes."}
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-2xl bg-late/10 px-4 py-3 text-sm text-late">
          {error}
        </p>
      ) : null}

      {flight ? (
        <div className="flex flex-col gap-4" aria-live="polite">
          {purpose === "pickup" ? (
            <PickupTabs
              tab={pickupTab}
              onTab={setPickupTab}
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
          ) : (
            <>
              <FlightSummary flight={flight} now={now} purpose="dropoff" />
              <Dropoff
                flight={flight}
                now={now}
                early={early}
                onEarly={(minutes) => setEarlyValue(String(minutes))}
                draft={addressField}
                onDraft={setDraft}
                onAddress={onAddress}
                drive={drive}
                driveError={addressError ?? driveError}
                driveLoading={driveLoading}
              />
              <RouteMap flight={flight} />
            </>
          )}
          <div className="flex items-center justify-between gap-3 px-1 text-xs text-muted">
            <p className="min-w-0 truncate">
              {updatedAt ? `Updated ${formatAgo(updatedAt, now)}` : "Updated"}
              {refreshNote ? ` · ${refreshNote}` : ""}
            </p>
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
            Type a flight number. Pickup times the drive to meet an arrival. Dropoff times the drive to catch a departure.
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

function ModeButton({
  purpose,
  disabled,
  children,
}: {
  purpose: TripMode;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      name="purpose"
      value={purpose}
      disabled={disabled}
      className="h-12 rounded-2xl bg-amber text-base font-semibold text-ink disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function timingBadge(flight: FlightSnapshot): { label: string; tone: "late" | "early" | "quiet" } {
  if (flight.status === "cancelled") return { label: "CANCELLED", tone: "late" };
  if (flight.status === "diverted") return { label: "DIVERTED", tone: "late" };
  if (flight.delayed) return { label: "DELAYED", tone: "late" };
  if (flight.status === "scheduled") return { label: "SCHEDULED", tone: "quiet" };
  return { label: "ON-TIME", tone: "early" };
}

function PickupTabs({
  tab,
  onTab,
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
  tab: PickupTab;
  onTab: (tab: PickupTab) => void;
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
  return (
    <div>
      <div role="tablist" aria-label="Pickup" className="grid grid-cols-5 gap-1 rounded-2xl bg-card p-1">
        {PICKUP_TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`pickup-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`pickup-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTab(item.id)}
              className={`h-11 rounded-xl px-1 text-[11px] font-semibold sm:text-sm ${
                selected ? "bg-amber text-ink" : "text-muted"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`pickup-panel-${tab}`} aria-labelledby={`pickup-tab-${tab}`} className="mt-3">
        {tab === "flight" ? <FlightInfo flight={flight} /> : null}
        {tab === "departure" ? <DepartureTime flight={flight} now={now} /> : null}
        {tab === "arrival" ? (
          <section className="rounded-[1.75rem] border border-line bg-card px-4 py-5">
            <ArrivalBlock flight={flight} now={now} />
          </section>
        ) : null}
        {tab === "pickup" ? (
          <Pickup
            flight={flight}
            now={now}
            buffer={buffer}
            onBuffer={onBuffer}
            draft={draft}
            onDraft={onDraft}
            onAddress={onAddress}
            drive={drive}
            driveError={driveError}
            driveLoading={driveLoading}
          />
        ) : null}
        {tab === "route" ? <RouteMap flight={flight} /> : null}
      </div>
    </div>
  );
}

function FlightInfo({ flight }: { flight: FlightSnapshot }) {
  const badge = timingBadge(flight);
  return (
    <section className="rounded-[1.75rem] border border-line bg-card px-4 py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-wide text-cream">{flight.ident}</h1>
          <p className="text-sm text-muted">{flight.friendlyName}</p>
        </div>
        <Chip tone={badge.tone}>{badge.label}</Chip>
      </div>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        <Airport code={flight.origin.code} name={flight.origin.name} place={flight.origin.location} />
        <span className="px-1 pt-1 text-amber" aria-hidden="true">
          →
        </span>
        <Airport code={flight.destination.code} name={flight.destination.name} place={flight.destination.location} align="end" />
      </div>
      {flight.aircraft ? <p className="mt-4 text-sm text-muted">{flight.aircraft}</p> : null}
      {flight.delayed && flight.delayMinutes != null ? (
        <p className="mt-2 text-sm text-late">{Math.abs(flight.delayMinutes)} min late</p>
      ) : null}
      {flight.early && flight.delayMinutes != null ? (
        <p className="mt-2 text-sm text-early">{Math.abs(flight.delayMinutes)} min early</p>
      ) : null}
    </section>
  );
}

function DepartureTime({ flight, now }: { flight: FlightSnapshot; now: number }) {
  const actual = flight.departure.actual;
  const estimated = flight.departure.estimated;
  const scheduled = flight.departure.scheduled;
  const when = actual ?? estimated ?? scheduled;
  const label = actual ? "Actual departure" : estimated ? "Estimated departure" : "Scheduled departure";
  const viewerZone = when ? timeZoneName(when) : "";
  const airportZone = flight.origin.timeZone;
  const airportClock = when ? formatClock(when, airportZone) : null;
  const viewerClock = when ? formatClock(when) : null;
  return (
    <section className="rounded-[1.75rem] border border-line bg-card px-4 py-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-sm text-cream/80">
        {flight.origin.code}
        {flight.origin.location ? ` · ${flight.origin.location}` : ""}
      </p>
      {when && viewerClock ? (
        <>
          <p className={`${fraunces.className} mt-4 text-5xl leading-none tracking-tight text-cream`}>{viewerClock}</p>
          <p className="mt-2 text-sm text-muted">
            {formatDay(when)}
            {viewerZone ? ` · ${viewerZone}` : ""}
            {` · ${formatUntil(when, now)}`}
            {" · your time"}
          </p>
          {airportClock && airportClock !== viewerClock ? (
            <p className="mt-2 text-sm text-muted">
              {airportClock} {timeZoneName(when, airportZone)} at the airport
            </p>
          ) : null}
          {scheduled && actual == null && estimated && Math.abs(estimated - scheduled) >= 5 * 60 ? (
            <p className="mt-3 text-sm text-muted">Scheduled {formatClock(scheduled)} {timeZoneName(scheduled)}</p>
          ) : null}
        </>
      ) : (
        <p className="mt-4 text-sm text-muted">Departure time isn&apos;t posted yet.</p>
      )}
    </section>
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

function FlightSummary({ flight, now, purpose }: { flight: FlightSnapshot; now: number; purpose: TripMode }) {
  const departAt = flight.departure.estimated ?? flight.departure.scheduled;
  const waitingToLeave =
    departAt != null &&
    flight.status !== "cancelled" &&
    flight.status !== "diverted" &&
    !hasDeparted(flight);
  const tone = flight.status === "cancelled" || flight.status === "diverted"
    ? "late"
    : flight.status === "enroute" || flight.status === "taxiing"
      ? "sky"
      : flight.status === "arrived"
        ? "early"
        : "quiet";

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

      {purpose === "dropoff" ? (
        <DropoffFlight flight={flight} now={now} departAt={departAt} waitingToLeave={waitingToLeave} />
      ) : (
        <>
          {waitingToLeave && departAt != null ? (
            <DepartureWait flight={flight} departAt={departAt} now={now} />
          ) : hasDeparted(flight) && flight.aircraft ? (
            <p className="mt-3 text-sm text-muted">{flight.aircraft}</p>
          ) : null}
          <ArrivalBlock flight={flight} now={now} />
        </>
      )}
    </section>
  );
}

function ArrivalBlock({ flight, now }: { flight: FlightSnapshot; now: number }) {
  const zone = flight.destination.timeZone;
  const when = arrivalInstant(flight.arrival);
  const airportClock = when ? formatClock(when, zone) : null;
  const localClock = when ? formatClock(when) : null;
  const zoneLabel = when ? timeZoneName(when, zone) : "";
  const headline = flight.status === "arrived" ? "Arrived" : flight.arrival.actual ? "Arrived" : "Arrives";
  const speed = flight.position?.groundspeedKt;
  const altitude = flight.position?.altitudeFt;
  return (
    <>
      <div>
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
        <Info label="Terminal" value={flight.destination.terminal} detail={flight.destination.terminalName} />
        <Info label="Gate" value={flight.destination.gate} />
      </dl>
    </>
  );
}

function DropoffFlight({
  flight,
  now,
  departAt,
  waitingToLeave,
}: {
  flight: FlightSnapshot;
  now: number;
  departAt: number | null;
  waitingToLeave: boolean;
}) {
  const gone = hasDeparted(flight);
  const arrival = arrivalInstant(flight.arrival);
  return (
    <>
      {gone ? (
        <div className="mt-5">
          <p className="text-sm text-muted">Already departed</p>
          <p className={`${fraunces.className} mt-1 text-4xl leading-none text-cream`}>
            {flight.departure.actual ? formatClock(flight.departure.actual, flight.origin.timeZone) : "Left"}
          </p>
          {flight.aircraft ? <p className="mt-2 text-sm text-muted">{flight.aircraft}</p> : null}
        </div>
      ) : waitingToLeave && departAt != null ? (
        <DepartureWait flight={flight} departAt={departAt} now={now} prominent />
      ) : (
        <p className="mt-5 text-sm text-muted">Departure time isn&apos;t posted yet.</p>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-3">
        <Info label="Depart terminal" value={flight.origin.terminal} detail={flight.origin.terminalName} />
        <Info label="Depart gate" value={flight.origin.gate} />
      </dl>

      {arrival != null ? (
        <p className="mt-4 text-sm text-muted">
          Lands at {flight.destination.code} {formatClock(arrival, flight.destination.timeZone)}{" "}
          {timeZoneName(arrival, flight.destination.timeZone)}
        </p>
      ) : null}
    </>
  );
}

function hasDeparted(flight: FlightSnapshot) {
  return (
    flight.status === "enroute" ||
    flight.status === "taxiing" ||
    flight.status === "arrived" ||
    flight.departure.actual != null
  );
}

function DepartureWait({
  flight,
  departAt,
  now,
  prominent = false,
}: {
  flight: FlightSnapshot;
  departAt: number;
  now: number;
  prominent?: boolean;
}) {
  const zone = flight.origin.timeZone;
  const remainingMs = departAt * 1000 - now;
  const due = remainingMs < -30_000;
  const soon = Math.abs(remainingMs) < 30_000;
  return (
    <div className={prominent ? "mt-5" : "mt-5 rounded-2xl bg-card-2 px-4 py-4"}>
      <p className="text-sm text-muted">{due ? "Departure estimate passed" : "Until departure"}</p>
      <p className={`${fraunces.className} mt-1 leading-none tracking-tight text-cream ${prominent ? "text-5xl" : "text-4xl"}`}>
        {soon ? "Now" : formatSpan(Math.abs(remainingMs) / 1000)}
      </p>
      <p className="mt-2 text-sm text-muted">
        {formatClock(departAt, zone)} {timeZoneName(departAt, zone)}
        {" · "}
        {formatDay(departAt, zone)}
      </p>
      {flight.aircraft ? <p className="mt-1 text-sm text-muted">{flight.aircraft}</p> : null}
    </div>
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

function Info({ label, value, detail }: { label: string; value: string | null; detail?: string | null }) {
  return (
    <div className="rounded-2xl bg-card-2 px-3 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`${fraunces.className} mt-1 text-2xl leading-none text-cream`}>{value || "Not posted"}</dd>
      {detail ? <p className="mt-1 text-sm leading-5 text-cream/80">{detail}</p> : null}
    </div>
  );
}

function tripOf(key: string) {
  const parts = key.split("|");
  return parts.slice(0, -1).join("|");
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

      <AddressForm
        draft={draft}
        onDraft={onDraft}
        onAddress={onAddress}
        driveLoading={driveLoading}
        hasDrive={drive != null}
        driveError={driveError}
      />
    </section>
  );
}

function Dropoff({
  flight,
  now,
  early,
  onEarly,
  draft,
  onDraft,
  onAddress,
  drive,
  driveError,
  driveLoading,
}: {
  flight: FlightSnapshot;
  now: number;
  early: EarlyBuffer;
  onEarly: (minutes: EarlyBuffer) => void;
  draft: string;
  onDraft: (value: string) => void;
  onAddress: (event: FormEvent<HTMLFormElement>) => void;
  drive: DriveEstimate | null;
  driveError: string | null;
  driveLoading: boolean;
}) {
  const departAt = flight.departure.estimated ?? flight.departure.scheduled;
  const gone = hasDeparted(flight) || flight.status === "cancelled" || flight.status === "diverted";
  const plan = !gone && departAt != null && drive
    ? planDropoff({
        departUnix: departAt,
        driveSeconds: drive.durationSeconds,
        earlyMinutes: early,
        nowUnix: Math.floor(now / 1000),
      })
    : null;
  const airport = flight.origin.code;
  const zone = flight.origin.timeZone;

  return (
    <section className="rounded-[1.75rem] border border-line bg-card px-4 py-5">
      <h2 className="text-sm font-medium text-cream">Dropoff</h2>
      <p className="mt-1 text-sm leading-5 text-muted">
        A typical drive to {airport}, timed so you arrive before departure. This is not live traffic.
      </p>

      <fieldset className="mt-4">
        <legend className="text-xs text-muted">Arrive before departure</legend>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {EARLY_BUFFERS.map((minutes) => (
            <label
              key={minutes}
              className={`flex h-10 items-center justify-center rounded-xl border text-sm ${
                early === minutes ? "border-amber bg-amber/15 text-amber-2" : "border-line bg-card-2 text-muted"
              }`}
            >
              <input
                type="radio"
                name="early-buffer"
                value={minutes}
                checked={early === minutes}
                onChange={() => onEarly(minutes)}
                className="sr-only"
              />
              {formatLead(minutes)}
            </label>
          ))}
        </div>
      </fieldset>

      {flight.status === "cancelled" ? (
        <p className="mt-4 text-sm text-late">This flight is cancelled, so there is no drop-off time.</p>
      ) : flight.status === "diverted" || hasDeparted(flight) ? (
        <p className="mt-4 text-sm text-muted">This flight has already left, so there is no drop-off time.</p>
      ) : plan && drive && departAt != null ? (
        <div className="mt-4">
          <p className="text-sm text-muted">{plan.leaveNow ? "Leave now" : "Leave by"}</p>
          <p className={`${fraunces.className} mt-1 text-4xl leading-none text-amber-2`}>
            {plan.leaveNow ? "Now" : formatClock(plan.leaveUnix)}
          </p>
          <p className="mt-2 text-sm leading-5 text-muted">
            {formatSpan(drive.durationSeconds)} · {formatMiles(drive.distanceMeters)} to {airport}.
            {plan.leaveNow && now / 1000 + plan.driveSeconds > departAt
              ? " The flight leaves before you would get there."
              : plan.leaveNow
                ? ` You'll arrive about ${formatSpan(plan.lateBySeconds)} after the ${formatLead(early)} early target.`
                : ` Be at the airport about ${formatLead(early)} before the ${formatClock(departAt, zone)} departure.`}
          </p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">From {drive.label}</p>
        </div>
      ) : departAt == null ? (
        <p className="mt-4 text-sm text-muted">I need a departure time before I can say when to leave.</p>
      ) : null}

      <AddressForm
        draft={draft}
        onDraft={onDraft}
        onAddress={onAddress}
        driveLoading={driveLoading}
        hasDrive={drive != null}
        driveError={driveError}
      />
    </section>
  );
}

function AddressForm({
  draft,
  onDraft,
  onAddress,
  driveLoading,
  hasDrive,
  driveError,
}: {
  draft: string;
  onDraft: (value: string) => void;
  onAddress: (event: FormEvent<HTMLFormElement>) => void;
  driveLoading: boolean;
  hasDrive: boolean;
  driveError: string | null;
}) {
  return (
    <>
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
          {driveLoading ? "Estimating…" : hasDrive ? "Update drive" : "Estimate drive"}
        </button>
      </form>
      {driveError ? (
        <p role="alert" className="mt-3 text-sm text-late">
          {driveError}
        </p>
      ) : null}
    </>
  );
}
