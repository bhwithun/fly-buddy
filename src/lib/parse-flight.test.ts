import assert from "node:assert/strict";
import test from "node:test";
import { FlightNotFoundError, parseTrackpoll } from "./parse-flight";

const fetchedAt = "2026-10-01T22:00:00.000Z";

function sample(overrides: Record<string, unknown> = {}) {
  return {
    flights: {
      "SWA4546-1": {
        ident: "SWA4546",
        iataIdent: "WN4546",
        friendlyIdent: "Southwest 4546",
        flightStatus: "",
        cancelled: false,
        diverted: false,
        airline: { shortName: "Southwest" },
        aircraft: { friendlyType: "Boeing 737 MAX 8" },
        origin: {
          iata: "BNA",
          friendlyName: "Nashville Intl",
          friendlyLocation: "Nashville, TN",
          coord: [-86.6782, 36.1245],
          TZ: ":America/Chicago",
          gate: "B4",
          terminal: null,
        },
        destination: {
          iata: "DTW",
          friendlyName: "Detroit Metro Wayne Co",
          friendlyLocation: "Detroit, MI",
          coord: [-83.3534, 42.2124],
          TZ: ":America/New_York",
          gate: "D20",
          terminal: "E",
        },
        gateDepartureTimes: { scheduled: 1790990700, estimated: 1790990700, actual: null },
        gateArrivalTimes: { scheduled: 1790996400, estimated: 1791001800, actual: null },
        takeoffTimes: { scheduled: 1790991300, estimated: 1790991300, actual: null },
        landingTimes: { scheduled: 1790995800, estimated: 1791000900, actual: null },
        waypoints: [
          [-86.68, 36.12],
          [-85.2, 38.4],
          [-83.35, 42.21],
        ],
        track: null,
        coord: null,
        links: { permanent: "/live/flight/SWA4546/history/20261002/0135Z/KBNA/KDTW" },
        ...overrides,
      },
    },
  };
}

test("reads arrival airport, terminal, gate, and delay", () => {
  const flight = parseTrackpoll(sample(), fetchedAt);
  assert.equal(flight.ident, "WN4546");
  assert.equal(flight.friendlyName, "Southwest 4546");
  assert.equal(flight.origin.code, "BNA");
  assert.equal(flight.origin.location, "Nashville, TN");
  assert.equal(flight.destination.code, "DTW");
  assert.equal(flight.destination.terminal, "E");
  assert.equal(flight.destination.gate, "D20");
  assert.equal(flight.destination.timeZone, "America/New_York");
  assert.equal(flight.status, "scheduled");
  assert.equal(flight.delayed, true);
  assert.equal(flight.delayMinutes, 90);
  assert.equal(flight.route.length, 3);
  assert.equal(flight.flightAwareUrl, "https://www.flightaware.com/live/flight/SWA4546/history/20261002/0135Z/KBNA/KDTW");
});

test("marks an airborne flight and keeps the track", () => {
  const flight = parseTrackpoll(
    sample({
      flightStatus: "En Route",
      coord: [-84.5, 39.1],
      altitude: 32000,
      groundspeed: 448,
      heading: 42,
      track: [
        { coord: [-86.6, 36.2], alt: 8000, gs: 250 },
        { coord: [-84.5, 39.1], alt: 32000, gs: 448 },
      ],
    }),
    fetchedAt,
  );
  assert.equal(flight.status, "enroute");
  assert.equal(flight.position?.lat, 39.1);
  assert.equal(flight.position?.altitudeFt, 32000);
  assert.equal(flight.track.length, 2);
});

test("marks an arrived flight from actual gate time", () => {
  const flight = parseTrackpoll(
    sample({
      flightStatus: "arrived",
      gateArrivalTimes: { scheduled: 1790996400, estimated: 1790997000, actual: 1790997300 },
    }),
    fetchedAt,
  );
  assert.equal(flight.status, "arrived");
  assert.equal(flight.arrival.actual, 1790997300);
  assert.equal(flight.delayed, true);
  assert.equal(flight.delayMinutes, 15);
  assert.equal(flight.position, null);
});

test("rejects an unknown flight page", () => {
  assert.throws(
    () => parseTrackpoll({ flights: { bad: { ident: null } } }),
    FlightNotFoundError,
  );
});
