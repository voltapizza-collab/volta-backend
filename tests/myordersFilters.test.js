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
  assert.equal(order.paymentStatus, "card_paid");
});

for (const paymentStatus of ["awaiting_card_payment", "cash_pending"]) {
  test(`confirmed card overrides stale ${paymentStatus} without rewriting the sale`, () => {
    const sale = { id: 3, status: "PAID", products: [], total: 11.18,
      customerData: { paymentMode: "card", paymentStatus } };
    const order = formatSale(sale);
    assert.equal(order.paymentMode, "card");
    assert.equal(order.paymentStatus, "card_paid");
    assert.equal(order.customerData.paymentStatus, "card_paid");
    assert.equal(sale.customerData.paymentStatus, paymentStatus);
  });
}

test("an unconfirmed or canceled card is never inferred paid from Stripe identifiers", () => {
  for (const status of ["PENDING", "AWAITING_PAYMENT", "CANCELED"]) {
    const order = formatSale({ id: 4, status, stripeCheckoutSessionId: "cs_unpaid", products: [], customerData: {} });
    assert.equal(order.paymentMode, "card");
    assert.notEqual(order.paymentStatus, "card_paid");
  }
});

test("cash collection is determined independently of the kitchen PAID status", () => {
  for (const [stored, expected] of [[undefined, "cash_pending"], ["cash_pending", "cash_pending"], ["cash_paid", "cash_paid"]]) {
    const order = formatSale({ id: 5, status: "PAID", products: [],
      customerData: { paymentMode: "cash", paymentStatus: stored } });
    assert.equal(order.paymentMode, "cash");
    assert.equal(order.paymentStatus, expected);
  }
});
