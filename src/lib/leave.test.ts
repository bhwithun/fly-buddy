import assert from "node:assert/strict";
import test from "node:test";
import { arrivalInstant, planLeave } from "./leave";

test("leave time is arrival plus curb buffer minus the drive", () => {
  const plan = planLeave({
    arrivalUnix: 1_000_000,
    driveSeconds: 34 * 60,
    bufferMinutes: 20,
    nowUnix: 900_000,
  });
  assert.equal(plan.readyUnix, 1_000_000 + 20 * 60);
  assert.equal(plan.leaveUnix, plan.readyUnix - 34 * 60);
  assert.equal(plan.leaveNow, false);
  assert.equal(plan.lateBySeconds, 0);
});

test("says to leave now once the window has passed", () => {
  const plan = planLeave({
    arrivalUnix: 1_000_000,
    driveSeconds: 40 * 60,
    bufferMinutes: 20,
    nowUnix: 1_000_000,
  });
  assert.equal(plan.leaveNow, true);
  assert.equal(plan.lateBySeconds, 20 * 60);
});

test("prefers the actual arrival, then the estimate", () => {
  assert.equal(arrivalInstant({ actual: 30, estimated: 20, scheduled: 10 }), 30);
  assert.equal(arrivalInstant({ actual: null, estimated: 20, scheduled: 10 }), 20);
  assert.equal(arrivalInstant({ actual: null, estimated: null, scheduled: null }), null);
});
