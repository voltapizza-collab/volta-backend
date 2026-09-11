import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import checkoutRoutes from "../routes/checkout.js";
import {
  canStoreFulfillDeliveryMethod,
  computeCheckoutDeliveryFee,
} from "../routes/checkout.js";
import { createOrderCheckoutSession } from "../services/stripe.js";

test("checkout delivery fee uses fixed courier pricing", () => {
  assert.equal(
    computeCheckoutDeliveryFee(
      { deliveryPricingMode: "FIXED", deliveryFeeFixed: 2.5 },
      { method: "COURIER", deliveryFee: 99 }
    ),
    2.5
  );
});

test("checkout delivery fee uses variable pricing when distance is available", () => {
  assert.equal(
    computeCheckoutDeliveryFee(
      {
        deliveryPricingMode: "VARIABLE",
        deliveryFeeBase: 3,
        deliveryBaseKm: 2,
        deliveryExtraPerKm: 1.25,
      },
      { method: "COURIER", distanceKm: 4.1 }
    ),
    6.75
  );
});

test("checkout delivery fee falls back to resolved fee for manual delivery coverage", () => {
  assert.equal(
    computeCheckoutDeliveryFee(
      { deliveryPricingMode: "VARIABLE", deliveryFeeBase: 3 },
      { method: "COURIER", deliveryFee: 4.5 }
    ),
    4.5
  );

  assert.equal(
    computeCheckoutDeliveryFee(
      { deliveryPricingMode: "FIXED", deliveryFeeFixed: 2.5 },
      { method: "PICKUP", deliveryFee: 2.5 }
    ),
    0
  );
});

test("checkout validates store delivery method availability", () => {
  assert.equal(
    canStoreFulfillDeliveryMethod({ pickupEnabled: true, deliveryEnabled: false }, "PICKUP"),
    true
  );
  assert.equal(
    canStoreFulfillDeliveryMethod({ pickupEnabled: true, deliveryEnabled: false }, "COURIER"),
    false
  );
  assert.equal(
    canStoreFulfillDeliveryMethod({ pickupEnabled: false, deliveryEnabled: true }, "PICKUP"),
    false
  );
  assert.equal(
    canStoreFulfillDeliveryMethod({ pickupEnabled: false, deliveryEnabled: true }, "COURIER"),
    true
  );
});

for (const paymentMethod of ["card", "klarna"]) {
test(`order checkout sends only ${paymentMethod}, hides Link and preserves order metadata`, async () => {
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  const previousKlarna = process.env.STRIPE_ENABLE_KLARNA;
  const previousFetch = globalThis.fetch;
  const requests = [];

  try {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    process.env.STRIPE_ENABLE_KLARNA = "1";
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        text: async () => JSON.stringify({ id: "cs_test_unit", url: "https://checkout.stripe.test/session" }),
      };
    };

    await createOrderCheckoutSession({
      sale: {
        id: 77,
        code: "VLT-77",
        createdAt: new Date("2026-09-09T12:00:00Z"),
        customerData: {
          name: "Luigi",
          phone: "+34600111222",
          email: "cliente@example.com",
          address_1: "Calle Mayor 12, 28013 Madrid",
          zipCode: "28013",
          delivery: { method: "COURIER" },
        },
      },
      partner: { id: 3 },
      store: { id: 4, storeName: "Volta Centro" },
      amountCents: 1490,
      ...(paymentMethod === "klarna" ? { paymentMethod } : {}),
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    });

    assert.equal(requests.length, 1);
    const body = new URLSearchParams(String(requests[0].options.body));
    assert.equal(requests[0].options.headers["Idempotency-Key"], `order-77-1490-${paymentMethod}`);
    assert.equal(Number(body.get("expires_at")), Date.parse("2026-09-09T12:35:00Z") / 1000);

    assert.equal(body.get("payment_method_types[0]"), paymentMethod);
    assert.equal(body.has("payment_method_types[1]"), false);
    assert.equal(body.get("wallet_options[link][display]"), "never");
    assert.equal(body.get("customer_email"), "cliente@example.com");
    assert.equal(body.get("phone_number_collection[enabled]"), "false");
    assert.equal(body.get("billing_address_collection"), paymentMethod === "klarna" ? "required" : null);
    assert.equal(body.has("shipping_details[name]"), false);
    assert.equal(body.has("shipping_details[address][line1]"), false);
    assert.equal(body.has("shipping_details[address][country]"), false);
    assert.equal(body.has("shipping_details[address][postal_code]"), false);
    assert.equal(body.get("metadata[customerName]"), "Luigi");
    assert.equal(body.get("metadata[customerPhone]"), "+34600111222");
    assert.equal(body.get("metadata[customerEmail]"), "cliente@example.com");
    assert.equal(body.get("payment_intent_data[metadata][customerPhone]"), "+34600111222");
  } finally {
    if (previousSecret == null) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    if (previousKlarna == null) delete process.env.STRIPE_ENABLE_KLARNA;
    else process.env.STRIPE_ENABLE_KLARNA = previousKlarna;
    globalThis.fetch = previousFetch;
  }
});
}

test("availability advertises configured methods and checkout rejects unavailable methods before database writes", async (t) => {
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  const previousKlarna = process.env.STRIPE_ENABLE_KLARNA;
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  t.after(() => {
    if (previousSecret == null) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    if (previousKlarna == null) delete process.env.STRIPE_ENABLE_KLARNA;
    else process.env.STRIPE_ENABLE_KLARNA = previousKlarna;
  });
  const prisma = {
    store: { findUnique: async () => ({ id: 1, active: true, hours: [] }) },
    $executeRawUnsafe: async () => assert.fail("Unavailable method must not reach the database"),
    $transaction: async () => assert.fail("Unavailable method must not create an order"),
  };
  const app = express(); app.use(express.json()); app.use(checkoutRoutes(prisma));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const enabled of ["1", "0"]) {
    process.env.STRIPE_ENABLE_KLARNA = enabled;
    const availability = await fetch(`${origin}/availability/1`).then(response => response.json());
    assert.deepEqual(availability.paymentMethods, enabled === "1" ? ["card", "klarna"] : ["card"]);
    for (const paymentMethod of enabled === "1" ? ["link", "paypal"] : ["link", "klarna"]) {
      const response = await fetch(`${origin}/session`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: 1, partnerId: 1, paymentMode: "card", paymentMethod, cart: [{ qty: 1 }] }) });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, "payment_method_not_available");
      await assert.rejects(createOrderCheckoutSession({ paymentMethod }), /payment_method_not_available/);
    }
  }
});

test("scheduled checkout shows the date in Stripe and lets Stripe collect missing email", async () => {
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  const previousFetch = globalThis.fetch;
  const requests = [];

  try {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        text: async () => JSON.stringify({ id: "cs_test_unit", url: "https://checkout.stripe.test/session" }),
      };
    };

    await createOrderCheckoutSession({
      sale: {
        id: 78,
        code: "VLT-78",
        customerData: {
          name: "Luigi",
          phone: "+34600111222",
          email: null,
          scheduledFor: "2026-09-07T12:30:00.000Z",
        },
      },
      partner: { id: 3 },
      store: { id: 4, storeName: "Volta Centro" },
      amountCents: 1490,
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    });

    assert.equal(requests.length, 1);
    const body = new URLSearchParams(String(requests[0].options.body));

    assert.equal(body.has("customer_email"), false);
    assert.equal(body.get("customer_creation"), "if_required");
    assert.equal(body.get("metadata[customerName]"), "Luigi");
    assert.equal(body.get("metadata[customerPhone]"), "+34600111222");
    assert.equal(body.has("metadata[customerEmail]"), false);
    assert.equal(body.get("metadata[scheduledFor]"), "2026-09-07T12:30:00.000Z");
    assert.match(body.get("line_items[0][price_data][product_data][description]"), /Pedido programado:/);
  } finally {
    if (previousSecret == null) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    globalThis.fetch = previousFetch;
  }
});
