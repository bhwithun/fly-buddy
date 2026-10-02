import assert from "node:assert/strict";
import test from "node:test";
import { commonTerminalName, matchTerminalName, resolveTerminalName, type TerminalPlace } from "./terminals";

const dtw: TerminalPlace[] = [
  { name: "A Concourse", ref: null, lat: 42.2085823, lon: -83.357856 },
  { name: "B Concourse", ref: null, lat: 42.208343, lon: -83.362498 },
  { name: "C Concourse", ref: null, lat: 42.210771, lon: -83.3607074 },
  { name: "D Concourse", ref: null, lat: 42.2260828, lon: -83.3488325 },
  { name: "McNamara Terminal", ref: null, lat: 42.207924, lon: -83.3565806 },
  { name: "Warren Cleage Evans Terminal", ref: null, lat: 42.2256094, lon: -83.3482903 },
];

test("shortens a personal name to the terminal people say", () => {
  assert.equal(commonTerminalName("Warren Cleage Evans Terminal"), "Evans Terminal");
  assert.equal(commonTerminalName("Tom Bradley International Terminal"), "Bradley International Terminal");
  assert.equal(commonTerminalName("Terminal 1"), "Terminal 1");
});

test("names DTW terminal E as Evans and keeps a plain concourse code quiet", () => {
  assert.equal(matchTerminalName("E", "D20", dtw), "Evans Terminal");
  assert.equal(matchTerminalName("D", "D20", dtw), "Evans Terminal");
  assert.equal(matchTerminalName("A", "A18", dtw), "McNamara Terminal");
  assert.equal(matchTerminalName("1", "C4", [{ name: "Terminal 1", ref: "1", lat: 1, lon: 1 }]), null);
});

test("resolves the bundled Detroit terminals from the airport coordinates", () => {
  assert.equal(
    resolveTerminalName({ terminal: "E", gate: "D20", lat: 42.2124, lon: -83.3534 }),
    "Evans Terminal",
  );
  assert.equal(resolveTerminalName({ terminal: "A", gate: "A18", lat: 42.2124, lon: -83.3534 }), "McNamara Terminal");
  assert.equal(resolveTerminalName({ terminal: "1", gate: "C4", lat: 36.08, lon: -115.15 }), null);
});

test("uses a building name that is not just the terminal code", () => {
  const places: TerminalPlace[] = [
    { name: "Tom Bradley International Terminal", ref: "B", lat: 33.94, lon: -118.41 },
  ];
  assert.equal(matchTerminalName("B", "148", places), "Bradley International Terminal");
});
