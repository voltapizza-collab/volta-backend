import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStorePayload,
  resolveStoreDeliveryMethods,
} from "../routes/stores.js";

test("new stores default to pickup and delivery enabled", () => {
  const methods = resolveStoreDeliveryMethods({});

  assert.deepEqual(methods, {
    pickupEnabled: true,
    deliveryEnabled: true,
  });
});

test("store patch keeps existing delivery methods when omitted", () => {
  const payload = buildStorePayload(
    { storeName: "Centro" },
    { pickupEnabled: false, deliveryEnabled: true }
  );

  assert.equal(payload.pickupEnabled, false);
  assert.equal(payload.deliveryEnabled, true);
});

test("store delivery methods can be delivery only", () => {
  const methods = resolveStoreDeliveryMethods({
    pickupEnabled: false,
    deliveryEnabled: true,
  });

  assert.deepEqual(methods, {
    pickupEnabled: false,
    deliveryEnabled: true,
  });
});

test("store delivery method selection exposes invalid empty state", () => {
  const methods = resolveStoreDeliveryMethods(
    { pickupEnabled: false, deliveryEnabled: false },
    { pickupEnabled: true, deliveryEnabled: true }
  );

  assert.equal(methods.pickupEnabled || methods.deliveryEnabled, false);
});
