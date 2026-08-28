import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateCouponDiscount,
  getCouponLines,
  getEligibleCouponSubtotal,
  validateCouponForCheckout,
} from "../routes/checkout.js";

test("coupon subtotal excludes promos, top deals, boosts and rewards", () => {
  const lines = [
    { cartLineId: "normal-1", pizzaId: 1, category: "Pizzas", subtotal: 12 },
    { cartLineId: "promo-1", type: "PROMO", source: "promo", promoId: 9, subtotal: 20 },
    { cartLineId: "top-1", pizzaId: 2, directDiscount: { id: 3 }, subtotal: 8 },
    { cartLineId: "boost-1", source: "queue_boost", subtotal: 1 },
    { cartLineId: "reward-1", type: "INCENTIVE_REWARD", source: "incentive_reward", subtotal: -10 },
    { cartLineId: "coupon-1", type: "COUPON", source: "coupon", subtotal: -2 },
  ];

  assert.equal(getEligibleCouponSubtotal(lines), 12);
});

test("coupon subtotal excludes active top deals even when the cart omits directDiscount", () => {
  const activeTopDeals = [
    {
      id: 7,
      status: "ACTIVE",
      targetType: "PRODUCT",
      productIds: [44],
      storeIds: [3],
    },
  ];

  const lines = [
    { cartLineId: "normal-1", pizzaId: 12, category: "Pizzas", subtotal: 10 },
    { cartLineId: "tampered-top-deal", pizzaId: 44, category: "Pizzas", subtotal: 7 },
  ];

  assert.equal(getEligibleCouponSubtotal(lines, { activeTopDeals, storeId: 3 }), 10);
});

test("coupon subtotal excludes active category top deals by category id or name", () => {
  const activeTopDeals = [
    {
      id: 8,
      status: "ACTIVE",
      targetType: "CATEGORY",
      categoryIds: [5],
      categoryNames: ["Especiales"],
      storeIds: [],
    },
  ];

  const lines = [
    { cartLineId: "category-id-top-deal", pizzaId: 20, categoryId: 5, category: "Pizzas", subtotal: 9 },
    { cartLineId: "category-name-top-deal", pizzaId: 21, category: "Especiales", subtotal: 11 },
    { cartLineId: "normal-1", pizzaId: 22, categoryId: 6, category: "Clasicas", subtotal: 13 },
  ];

  assert.equal(getEligibleCouponSubtotal(lines, { activeTopDeals, storeId: 3 }), 13);
});

test("delivery free coupon discounts the delivery fee", () => {
  const coupon = {
    kind: "AMOUNT",
    variant: "FIXED",
    amount: "0.00",
    campaign: "DELIVERY_FREE",
    meta: { deliveryFree: true },
  };

  assert.equal(calculateCouponDiscount(coupon, 0, { deliveryFee: 2.5 }), 2.5);
  assert.equal(calculateCouponDiscount(coupon, 30, { deliveryFee: 0 }), 0);
});

test("channel shift QR coupons do not stack with top deals or other coupon lines", () => {
  const activeTopDeals = [
    {
      id: 9,
      status: "ACTIVE",
      targetType: "PRODUCT",
      productIds: [44],
      storeIds: [3],
    },
  ];
  const lines = [
    { cartLineId: "normal-1", pizzaId: 12, category: "Pizzas", subtotal: 12 },
    { cartLineId: "top-deal-1", pizzaId: 44, category: "Pizzas", subtotal: 8 },
    { cartLineId: "coupon-QR", type: "COUPON", source: "coupon", couponCode: "CAMBIO_CANAL", subtotal: -5 },
    { cartLineId: "coupon-OTHER", type: "COUPON", source: "coupon", couponCode: "OTRO", subtotal: -5 },
  ];

  assert.equal(getEligibleCouponSubtotal(lines, { activeTopDeals, storeId: 3 }), 12);
  assert.equal(getCouponLines(lines).length, 2);
});

test("channel shift QR coupons are reusable until their expiration date", () => {
  const reference = new Date("2026-08-28T10:00:00.000Z");
  const coupon = {
    status: "ACTIVE",
    kind: "AMOUNT",
    variant: "FIXED",
    amount: "5.00",
    usageLimit: 1,
    usageUnlimited: true,
    usedCount: 25,
    activeFrom: new Date("2026-08-27T10:00:00.000Z"),
    expiresAt: new Date("2026-08-29T10:00:00.000Z"),
    meta: {
      channelShiftQr: true,
      targeting: {
        storeIds: [3],
      },
    },
  };

  assert.equal(
    validateCouponForCheckout(coupon, {
      eligibleSubtotal: 20,
      deliveryFee: 0,
      store: { id: 3, zipCode: "28001" },
      reference,
    }),
    null
  );

  assert.equal(
    validateCouponForCheckout(
      { ...coupon, expiresAt: new Date("2026-08-28T09:59:59.000Z") },
      {
        eligibleSubtotal: 20,
        deliveryFee: 0,
        store: { id: 3, zipCode: "28001" },
        reference,
      }
    ),
    "coupon_not_available"
  );
});
