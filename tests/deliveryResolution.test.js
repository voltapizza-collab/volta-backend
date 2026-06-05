import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildManualDeliveryResolution,
  computeDeliveryFee,
  isPreciseCustomerGeocode,
  selectDeliveryCoverageStores,
} from "../routes/partners.js";

const store = {
  id: 12,
  slug: "centro",
  storeName: "Centro",
  city: "Madrid",
};

test("manual delivery fallback keeps delivery available when radius cannot be measured", () => {
  const resolution = buildManualDeliveryResolution({
    address: "Calle Mayor 1, Madrid",
    partner: {
      deliveryRadiusKm: 5,
      deliveryPricingMode: "FIXED",
      deliveryFeeFixed: 2.5,
      deliveryFeeBlockSize: 5,
      deliveryMaxPizzasPerOrder: 20,
    },
    stores: [store],
    reason: "GOOGLE_GEOCODING_KEY not configured",
  });

  assert.equal(resolution.withinRange, true);
  assert.equal(resolution.coverageDistanceAvailable, false);
  assert.equal(resolution.coverageDistanceRequired, "MANUAL_REVIEW");
  assert.equal(resolution.deliveryFee, 2.5);
  assert.equal(resolution.nearestStore.slug, "centro");
  assert.equal(resolution.nearestStore.distanceSource, "MANUAL_FALLBACK");
});

test("manual delivery fallback uses the variable base fee when distance is unavailable", () => {
  const resolution = buildManualDeliveryResolution({
    address: "Calle Mayor 1, Madrid",
    partner: {
      deliveryRadiusKm: 5,
      deliveryPricingMode: "VARIABLE",
      deliveryFeeBase: 3,
      deliveryBaseKm: 2,
      deliveryExtraPerKm: 1,
    },
    stores: [store],
    reason: "NO_STORES_WITH_COORDS",
  });

  assert.equal(resolution.withinRange, true);
  assert.equal(resolution.deliveryFee, 3);
});

test("delivery fee still applies the kilometer policy when distance is known", () => {
  const fee = computeDeliveryFee(
    {
      deliveryPricingMode: "VARIABLE",
      deliveryFeeBase: 3,
      deliveryBaseKm: 2,
      deliveryExtraPerKm: 1.25,
    },
    4.1
  );

  assert.equal(fee, 6.75);
});

test("manual text geocodes can be approximate while still carrying usable coords", () => {
  assert.equal(
    isPreciseCustomerGeocode({
      partialMatch: false,
      types: ["route"],
      lat: 40.4168,
      lng: -3.7038,
    }),
    false
  );
});

test("delivery coverage keeps active stores when schedule filtering would leave none", () => {
  const closedByScheduleStore = {
    ...store,
    active: true,
    acceptingOrders: true,
    hours: [{ dayOfWeek: 1, openTime: 0, closeTime: 60 }],
  };
  const inactiveStore = {
    id: 99,
    slug: "inactive",
    active: false,
    acceptingOrders: true,
    hours: [],
  };

  const selectedStores = selectDeliveryCoverageStores(
    [closedByScheduleStore, inactiveStore],
    new Date("2026-06-01T12:00:00")
  );

  assert.deepEqual(
    selectedStores.map((item) => item.slug),
    ["centro"]
  );
});
