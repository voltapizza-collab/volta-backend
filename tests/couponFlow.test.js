import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCoupon, calculateCouponDiscount } from "../services/couponEvaluation.js";
import { lockCheckoutCoupon, releaseCouponReservation, reconcileCouponReservations } from "../services/couponReservations.js";

const coupon = { id: 1, status: "ACTIVE", kind: "AMOUNT", amount: 5, usageLimit: 1, usedCount: 0 };
const context = { eligibleSubtotal: 12, store: { id: 3, zipCode: "28001" }, reference: new Date("2026-09-09T10:00:00Z") };

test("empty cart and only excluded products explain different next steps", () => {
  assert.equal(evaluateCoupon(coupon).status, "empty_cart");
  assert.equal(evaluateCoupon(coupon, { hasProducts: true }).status, "no_eligible_products");
  assert.match(evaluateCoupon(coupon, { hasProducts: true }).message, /Top Deals/);
});
test("coupon minimum has an exact shortfall and accepts the boundary", () => {
  const result = evaluateCoupon({ ...coupon, minAmount: 15 }, context);
  assert.equal(result.status, "min_not_met"); assert.equal(result.missingAmount, 3);
  assert.equal(evaluateCoupon({ ...coupon, minAmount: 12 }, context).discount, 5);
});
test("dates are instants and weekly windows use Madrid including overnight windows", () => {
  assert.equal(evaluateCoupon({ ...coupon, expiresAt: context.reference }, context).status, "expired");
  assert.equal(evaluateCoupon({ ...coupon, activeFrom: new Date("2026-09-09T10:01:00Z") }, context).status, "not_started");
  assert.equal(evaluateCoupon({ ...coupon, daysActive: [3], windowStart: 720, windowEnd: 780 }, context).valid, true);
  assert.equal(evaluateCoupon({ ...coupon, daysActive: [2] }, context).status, "outside_window");
  assert.equal(evaluateCoupon({ ...coupon, windowStart: 1320, windowEnd: 120 }, { ...context, reference: new Date("2026-09-09T21:00:00Z") }).valid, true);
});
test("claimed coupons follow the same store scope as checkout", () => {
  const targeted = { ...coupon, visibility: "RESERVED", acquisition: "CLAIM", channel: "WEB", assignedToId: 1, meta: { targeting: { storeIds: [4] } } };
  assert.equal(evaluateCoupon(targeted, context).status, "wrong_area");
  assert.equal(evaluateCoupon(targeted, { ...context, store: { id: 4 } }).valid, true);
});
test("delivery-free types agree and percentage discounts cannot exceed the products", () => {
  for (const extra of [{ campaign: "DELIVERY_FREE" }, { code: "VOL-DF-ABC" }, { meta: '{"deliveryFree":true}' }]) {
    assert.equal(evaluateCoupon({ ...coupon, ...extra }, context).status, "no_delivery_fee");
    assert.equal(evaluateCoupon({ ...coupon, ...extra }, { ...context, deliveryFee: 2.5 }).discount, 2.5);
  }
  assert.equal(calculateCouponDiscount({ kind: "PERCENT", percent: 200 }, 12), 12);
  assert.equal(calculateCouponDiscount({ kind: "PERCENT", percent: 50, maxAmount: 3 }, 12), 3);
});
test("held capacity blocks allocation but unlimited coupons do not query reservations", async () => {
  let queries = 0;
  const tx = { $queryRawUnsafe: async () => ++queries === 1 ? [coupon] : [{ saleId: 3 }] };
  await assert.rejects(lockCheckoutCoupon(tx, { ...context, partnerId: 1, code: "X" }), /coupon_reserved/);
  const unlimited = { $queryRawUnsafe: async () => { queries++; return [{ ...coupon, usageUnlimited: true }]; } };
  queries = 0;
  await lockCheckoutCoupon(unlimited, { ...context, partnerId: 1, code: "X" });
  assert.equal(queries, 1);
});
test("expiry release cannot undo a paid sale or a different payment session", async () => {
  for (const sale of [{ status: "PAID" }, { status: "AWAITING_PAYMENT", stripeCheckoutSessionId: "other" }]) {
    const tx = { $queryRawUnsafe: async () => [sale], couponReservation: { updateMany: () => assert.fail("must not release") } };
    await releaseCouponReservation({ $transaction: fn => fn(tx) }, { id: "cs_1", metadata: { purpose: "order_checkout", saleId: "1" } });
  }
});
test("reconciliation never releases an open or completed session based on local age", async () => {
  const prisma = { couponReservation: { findMany: async () => [{ stripeSessionId: "cs_1" }] }, $transaction: () => assert.fail("must not release") };
  for (const status of ["open", "complete"]) await reconcileCouponReservations(prisma, 1, async () => ({ status }));
});
