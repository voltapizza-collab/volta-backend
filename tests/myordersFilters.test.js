import assert from "node:assert/strict";
import { test } from "node:test";
import { completedOrderWhere, formatSale } from "../routes/myorders.js";

test("completed daily orders require confirmed payment and processed order", () => {
  assert.deepEqual(completedOrderWhere({ partnerId: 1, storeId: 2, activeStoresOnly: false }), {
    partnerId: 1,
    storeId: 2,
    processed: true,
    status: "PAID",
  });
});

test("formatted POS orders preserve cash payment mode", () => {
  const order = formatSale({
    id: 1,
    code: "ORD-1",
    status: "PAID",
    processed: false,
    customerData: {
      name: "Cliente",
      paymentMode: "cash",
      paymentStatus: "cash_pending",
    },
    products: [],
    extras: [],
    total: 18.5,
  });

  assert.equal(order.paymentMode, "cash");
  assert.equal(order.paymentStatus, "cash_pending");
  assert.equal(order.customerData.paymentMode, "cash");
  assert.equal(order.customerData.paymentStatus, "cash_pending");
});

test("formatted POS orders infer card payment from Stripe ids", () => {
  const order = formatSale({
    id: 2,
    code: "ORD-2",
    status: "PAID",
    processed: false,
    customerData: { name: "Cliente" },
    stripeCheckoutSessionId: "cs_test_123",
    products: [],
    extras: [],
    total: 21,
  });

  assert.equal(order.paymentMode, "card");
  assert.equal(order.customerData.paymentMode, "card");
});
