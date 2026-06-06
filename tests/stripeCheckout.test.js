import assert from "node:assert/strict";
import { test } from "node:test";
import { createOrderCheckoutSession } from "../services/stripe.js";

test("order checkout sends only card/email-facing Stripe fields and keeps customer data in metadata", async () => {
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
    assert.equal(body.has("payment_method_types[1]"), false);
    assert.equal(body.get("customer_email"), "cliente@example.com");
    assert.equal(body.get("phone_number_collection[enabled]"), "false");
    assert.equal(body.has("billing_address_collection"), false);
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
