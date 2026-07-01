import assert from "node:assert/strict";
import { test } from "node:test";
import { computeCheckoutDeliveryFee } from "../routes/checkout.js";
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

test("order checkout sends card and Klarna Stripe fields without unsupported shipping details", async () => {
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
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    });

    assert.equal(requests.length, 1);
    const body = new URLSearchParams(String(requests[0].options.body));

    assert.equal(body.get("payment_method_types[0]"), "card");
    assert.equal(body.get("payment_method_types[1]"), "klarna");
    assert.equal(body.get("customer_email"), "cliente@example.com");
    assert.equal(body.get("phone_number_collection[enabled]"), "false");
    assert.equal(body.get("billing_address_collection"), "required");
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

test("order checkout lets Stripe collect email when customer email is missing", async () => {
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
  } finally {
    if (previousSecret == null) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    globalThis.fetch = previousFetch;
  }
});
