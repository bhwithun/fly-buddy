import assert from "node:assert/strict";
import test from "node:test";
import { cookiePair, readCookieValue } from "./prefs";

test("round-trips an address that contains commas and spaces", () => {
  const pair = cookiePair("fly-buddy-address", "123 Woodward Ave, Detroit, MI", false);
  assert.equal(readCookieValue(pair.split(";")[0], "fly-buddy-address"), "123 Woodward Ave, Detroit, MI");
  assert.match(pair, /Path=\/; Max-Age=\d+; SameSite=Lax$/);
});

test("adds Secure only for https", () => {
  assert.match(cookiePair("fly-buddy-flight", "WN4546", true), /; Secure$/);
  assert.equal(cookiePair("fly-buddy-flight", "WN4546", false).includes("Secure"), false);
});

test("clears a cookie with Max-Age=0", () => {
  assert.equal(cookiePair("fly-buddy-flight", "", true), "fly-buddy-flight=; Path=/; Max-Age=0; SameSite=Lax; Secure");
});
