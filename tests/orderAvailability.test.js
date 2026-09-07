import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import checkoutRoutes from "../routes/checkout.js";
import { buildOrderAvailability, validateOrderSchedule } from "../services/orderAvailability.js";
import { selectDeliveryCoverageStores } from "../routes/partners.js";

const monday = new Date("2026-09-07T10:00:00Z"); // noon in Madrid
const store = { id: 1, active: true, acceptingOrders: true, hours: [
  { dayOfWeek: 1, openTime: 14 * 60, closeTime: 23 * 60 + 30 },
  { dayOfWeek: 2, openTime: 14 * 60, closeTime: 23 * 60 + 30 },
] };

test("off-hours requires scheduling; today/tomorrow use service hours and closed days have no fallback", () => {
  const result = buildOrderAvailability(store, monday, "Europe/Madrid");
  assert.equal(result.requiresSchedule, true);
  assert.equal(result.acceptingOrders, true);
  assert.equal(result.days.length, 5);
  assert.equal(result.days[0].slots[0].time, "14:30");
  assert.equal(result.days[0].slots[0].scheduledFor, "2026-09-07T12:30:00.000Z");
  assert.equal(result.days[1].slots[0].time, "14:30");
  assert.deepEqual(result.days[2].slots, []);
});

test("manual closures disable every slot and cannot be bypassed with a schedule", () => {
  for (const closed of [{ ...store, active: false }, { ...store, acceptingOrders: false }]) {
    assert.equal(buildOrderAvailability(closed, monday).acceptingOrders, false);
    assert.throws(() => validateOrderSchedule(closed, "2026-09-07T12:30:00Z", monday), /store_closed/);
  }
});

test("pause requires scheduling during service, preserves future slots and resumes immediate orders", () => {
  const now = new Date("2026-09-07T15:00:00Z");
  const paused = { ...store, operationsPaused: true };
  const availability = buildOrderAvailability(paused, now);
  assert.equal(availability.acceptingOrders, true);
  assert.equal(availability.serviceOpen, false);
  assert.equal(availability.operationsPaused, true);
  assert.equal(availability.requiresSchedule, true);
  assert.ok(availability.days[0].slots.length > 0);
  assert.throws(() => validateOrderSchedule(paused, null, now), /schedule_required/);
  assert.doesNotThrow(() => validateOrderSchedule(paused, availability.days[0].slots[0].scheduledFor, now));
  assert.doesNotThrow(() => validateOrderSchedule({ ...paused, operationsPaused: false }, null, now));
  assert.throws(() => validateOrderSchedule({ ...paused, active: false }, availability.days[0].slots[0].scheduledFor, now), /store_closed/);
});

test("pause rejects immediate cash and card checkout before payment or sale creation", async (t) => {
  const paused = { ...store, operationsPaused: true, hours: [] };
  const prisma = {
    $executeRawUnsafe: async () => {}, $queryRawUnsafe: async () => [{ id: 1 }],
    store: { findFirst: async () => paused, findUnique: async () => paused },
    $transaction: async () => assert.fail("No immediate sale during pause"),
  };
  const app = express(); app.use(express.json()); app.use(checkoutRoutes(prisma));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const paymentMode of ["cash", "card"]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/session`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: 1, partnerId: 1, paymentMode, cart: [{ qty: 1 }] }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "schedule_required");
  }
});

test("server rejects missing, past, malformed, off-grid, closed-day and beyond-horizon schedules", () => {
  assert.throws(() => validateOrderSchedule(store, null, monday), /schedule_required/);
  for (const date of ["garbage", true, "2026-09-06T12:30:00Z", "2026-09-07T12:31:00Z", "2026-09-09T12:30:00Z", "2026-09-14T12:30:00Z"]) {
    assert.throws(() => validateOrderSchedule(store, date, monday), /schedule_invalid/);
  }
  assert.doesNotThrow(() => validateOrderSchedule(store, "2026-09-07T12:30:00Z", monday));
});

test("immediate orders work in service, but a closing boundary or schedule edit requires a new choice", () => {
  assert.doesNotThrow(() => validateOrderSchedule(store, null, new Date("2026-09-07T21:29:59Z")));
  assert.throws(() => validateOrderSchedule(store, null, new Date("2026-09-07T21:30:00Z")), /schedule_required/);
  const edited = { ...store, hours: [{ dayOfWeek: 1, openTime: 18 * 60, closeTime: 22 * 60 }] };
  assert.throws(() => validateOrderSchedule(edited, "2026-09-07T12:30:00Z", monday), /schedule_invalid/);
});

test("overnight service carries into the next day and keeps its opening offset", () => {
  const overnight = { ...store, hours: [{ dayOfWeek: 1, openTime: 22 * 60, closeTime: 2 * 60 }] };
  const result = buildOrderAvailability(overnight, new Date("2026-09-07T23:00:00Z"));
  assert.equal(result.serviceOpen, true);
  assert.equal(result.days[0].date, "2026-09-08");
  assert.equal(result.days[0].slots[0].time, "01:15");
  assert.equal(result.days[0].slots.at(-1).time, "02:00");
});

test("DST slots are actual instants and no nonexistent local time is offered", () => {
  const sunday = { ...store, hours: [{ dayOfWeek: 0, openTime: 60, closeTime: 4 * 60 }] };
  const spring = buildOrderAvailability(sunday, new Date("2026-03-29T00:00:00Z"));
  assert.ok(!spring.days[0].slots.some((slot) => slot.time.startsWith("02:")));
  const autumn = buildOrderAvailability(sunday, new Date("2026-10-25T00:00:00Z"));
  const repeated = autumn.days[0].slots.filter((slot) => slot.time === "02:30");
  assert.equal(repeated.length, 2);
  assert.notEqual(repeated[0].scheduledFor, repeated[1].scheduledFor);
});

test("empty availability never accepts an immediate off-hours order", () => {
  const noSlots = { ...store, hours: [{ dayOfWeek: 0, openTime: 60, closeTime: 65 }] };
  assert.ok(buildOrderAvailability(noSlots, monday).days.every((day) => !day.slots.length));
  assert.throws(() => validateOrderSchedule(noSlots, null, monday), /schedule_required/);
});

test("delivery coverage retains off-hours stores alongside open stores and respects manual closures", () => {
  const stores = [store, { ...store, id: 2, hours: [] }, { ...store, id: 3, acceptingOrders: false }];
  assert.deepEqual(selectDeliveryCoverageStores(stores, monday).map((item) => item.id), [1, 2]);
});

test("HTTP checkout rejects missing or invalid schedules before creating a sale or charging", async (t) => {
  const allDays = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, openTime: 0, closeTime: 1 }));
  const closedByHours = { ...store, hours: allDays };
  const prisma = {
    $executeRawUnsafe: async () => {},
    $queryRawUnsafe: async () => [{ id: 1 }],
    store: { findFirst: async () => closedByHours, findUnique: async () => closedByHours },
    $transaction: async () => assert.fail("No sale may be created"),
  };
  const app = express();
  app.use(express.json());
  app.use(checkoutRoutes(prisma));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const availability = await fetch(`${origin}/availability/1`).then((response) => response.json());
  assert.equal(availability.acceptingOrders, true);
  if (availability.requiresSchedule) {
    const response = await fetch(`${origin}/session`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: 1, partnerId: 1, paymentMode: "cash", cart: [{ qty: 1 }] }) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "schedule_required");
  }
  // The test remains deterministic even if run during the one minute service window.
  for (const scheduledFor of ["invalid", "2000-01-01T00:00:00Z"]) {
    const response = await fetch(`${origin}/session`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: 1, partnerId: 1, paymentMode: "cash", cart: [{ qty: 1 }], scheduledFor }) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "schedule_invalid");
  }
});
