import test from "node:test";
import assert from "node:assert/strict";
import {
  autoProjectName, pickStandby, cleanupPlan, decide, describeDbUrl, hoursUntilNextWindowEnd, hoursUntilNextWindowStart, inSwitchWindow, istDay, istMinutes, newDatabaseName, prismaUrl, usageOf,
} from "./lib.mjs";

const at = (iso) => new Date(iso);
// 00:00 IST = 18:30 UTC (previous day); 05:30 IST = 00:00 UTC.
const IN_WINDOW = at("2026-11-20T21:00:00Z"); // 02:30 IST 21 Nov
const DAYTIME = at("2026-11-20T06:30:00Z"); // 12:00 IST

function usage(cuHours, { name = "P", burnPerDay = 6, hoursToReset = 200 } = {}) {
  return { id: name, name, cuHours, pct: cuHours / 100, burnPerHour: burnPerDay / 24, resetAt: "2026-12-01T00:00:00.000Z", hoursToReset };
}

test("IST clock and the 00:00-05:30 start window", () => {
  assert.equal(istMinutes(at("2026-11-20T20:30:00Z")), 120);
  assert.equal(inSwitchWindow(at("2026-11-20T18:29:00Z")), false); // 23:59 IST
  assert.equal(inSwitchWindow(at("2026-11-20T18:30:00Z")), true); // 00:00 IST
  assert.equal(inSwitchWindow(at("2026-11-20T23:59:00Z")), true); // 05:29 IST
  assert.equal(inSwitchWindow(at("2026-11-21T00:00:00Z")), false); // 05:30 IST
  assert.equal(hoursUntilNextWindowStart(at("2026-11-20T06:30:00Z")), 12); // 12:00 IST -> 00:00
  assert.equal(hoursUntilNextWindowStart(IN_WINDOW), 0);
  assert.equal(istDay(at("2026-11-20T20:30:00Z")), "2026-11-21");
});

test("horizon: next window end is tomorrow when already switching now", () => {
  assert.equal(hoursUntilNextWindowEnd(at("2026-11-20T22:00:00Z")), 26); // 03:30 IST -> tomorrow 05:30
  assert.equal(hoursUntilNextWindowEnd(at("2026-11-20T06:30:00Z")), 17.5); // 12:00 IST -> 05:30
});

test("usageOf reads Neon compute_time_seconds as CU-hours and the burn rate", () => {
  const u = usageOf({ id: "p", name: "BarberCue", compute_time_seconds: 342602, consumption_period_start: "2026-11-01T00:00:00Z", quota_reset_at: "2026-12-01T00:00:00Z" },
    at("2026-11-15T12:00:00Z"));
  assert.ok(Math.abs(u.cuHours - 95.17) < 0.01);
  assert.ok(Math.abs(u.pct - 0.9517) < 0.001);
  assert.equal(u.resetAt, "2026-12-01T00:00:00.000Z");
  assert.ok(u.burnPerHour > 0.27 && u.burnPerHour < 0.28);
  assert.throws(() => usageOf({ id: "x", consumption_period_start: "2026-11-01" }, at("2026-11-02T00:00:00Z")));
});

test("below threshold: ok, and a warning from 75%", () => {
  assert.equal(decide({ active: usage(40), other: usage(1), now: IN_WINDOW, autoswitch: true }).action, "ok");
  assert.equal(decide({ active: usage(80), other: usage(1), now: DAYTIME, autoswitch: true }).action, "warn");
});

test("over 90% inside the window with a fresh standby: switch", () => {
  const d = decide({ active: usage(91), other: usage(2), now: IN_WINDOW, autoswitch: true });
  assert.equal(d.action, "switch");
});

test("high burn switches BEFORE 90% when it would run out before the next window", () => {
  const d = decide({ active: usage(85, { burnPerDay: 20 }), other: usage(2), now: IN_WINDOW, autoswitch: true });
  assert.equal(d.action, "switch");
});

test("over 90% in the daytime waits for the window", () => {
  assert.equal(decide({ active: usage(91), other: usage(2), now: DAYTIME, autoswitch: true }).action, "wait-window");
});

test("auto-switch OFF never switches", () => {
  assert.equal(decide({ active: usage(95), other: usage(2), now: IN_WINDOW, autoswitch: false }).action, "blocked");
});

test("a half-used standby is replaced by a NEW project; a short-lived one is used with a warning", () => {
  const n = decide({ active: usage(95), other: usage(55), now: IN_WINDOW, autoswitch: true });
  assert.equal(n.action, "switch");
  assert.equal(n.target, "new");
  assert.equal(decide({ active: usage(95), other: usage(55), now: IN_WINDOW, autoswitch: true, allowNewProject: false }).action, "blocked");
  assert.equal(decide({ active: usage(95), other: null, now: IN_WINDOW, autoswitch: true }).target, "new");
  assert.equal(decide({ active: usage(95, { burnPerDay: 1 }), other: usage(55), now: DAYTIME, autoswitch: true }).action, "wait-window");
  const d = decide({ active: usage(95), other: usage(40, { hoursToReset: 300 }), now: IN_WINDOW, autoswitch: true });
  assert.equal(d.action, "switch");
  assert.equal(d.target, "existing");
  assert.ok(d.reasons.some((r) => r.startsWith("WARNING")));
});

test("no pointless switch when the allowance resets before it can run out", () => {
  const d = decide({ active: usage(91, { hoursToReset: 10 }), other: usage(2), now: IN_WINDOW, autoswitch: true });
  assert.equal(d.action, "warn");
});

test("cleanup keeps the live copy and ONE previous guard copy, never anything else", () => {
  const names = ["neondb", "fastque_final_20261023", "fastque_live_20261115", "fq_guard_202612012100", "fq_guard_202611202100",
    "fq_guard_202611102100", "fq_guard_x", "postgres"];
  assert.deepEqual(cleanupPlan(names, "fq_guard_202612012100"), ["fq_guard_202611102100"]);
  assert.deepEqual(cleanupPlan(names, "fastque_live_20261115"), ["fq_guard_202611202100", "fq_guard_202611102100"]);
  assert.deepEqual(cleanupPlan(names, ""), []);
  assert.deepEqual(cleanupPlan(["neondb", "fastque_live_20261115"], "fastque_live_20261115"), []);
});

test("names and URLs", () => {
  assert.equal(newDatabaseName(at("2026-11-20T21:05:00Z")), "fq_guard_202611202105");
  assert.deepEqual(describeDbUrl("postgresql://neondb_owner:secret@ep-silent-meadow-b3orxmoc.c-4.ap-southeast-1.aws.neon.tech/fastque_live_20261115?sslmode=require"), {
    user: "neondb_owner", host: "ep-silent-meadow-b3orxmoc.c-4.ap-southeast-1.aws.neon.tech", endpoint: "ep-silent-meadow-b3orxmoc", database: "fastque_live_20261115",
  });
  assert.equal(prismaUrl("postgresql://u:p@ep-a.c-3.neon.tech/db?sslmode=require&channel_binding=require"), "postgresql://u:p@ep-a.c-3.neon.tech/db?sslmode=require");
  assert.throws(() => prismaUrl("postgresql://u:p@ep-a-pooler.c-3.neon.tech/db"));
});

test("standby choice and auto project names", () => {
  assert.equal(pickStandby([usage(60, { name: "A" }), usage(3, { name: "B" }), usage(40, { name: "C" })]).name, "B");
  assert.equal(pickStandby([]), null);
  assert.equal(autoProjectName(at("2026-11-20T21:00:00Z")), "FastQue Prod Auto 2026-11-21");
});

test("URGENT: outside the window, switch at once when the allowance would run out before the next night", () => {
  // 12:00 IST, 96 CU-h used, burning 6/day: 2 CU-h left = 8 h < 12 h to midnight + 6 h margin.
  const d = decide({ active: usage(96), other: usage(2), now: DAYTIME, autoswitch: true });
  assert.equal(d.action, "switch");
  assert.equal(d.urgent, true);
  // Over 90% but plenty of time (slow burn): still waits for the night window.
  const w = decide({ active: usage(91, { burnPerDay: 1 }), other: usage(2), now: DAYTIME, autoswitch: true });
  assert.equal(w.action, "wait-window");
  // Urgent but auto-switch OFF: never switches.
  assert.equal(decide({ active: usage(96), other: usage(2), now: DAYTIME, autoswitch: false }).action, "blocked");
});
