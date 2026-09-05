import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateCouponDiscount,
  getCouponLines,
  getEligibleCouponSubtotal,
  validateTopDealAvailability,
  validateCouponForCheckout,
} from "../routes/checkout.js";
import {
  attachDirectDiscountUsage,
  getDirectDiscountDailyUsageFromSales,
  getDirectDiscountEffectiveValue,
  getDirectDiscountUsageFromSales,
} from "../services/directDiscountUsage.js";

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

test("top deal checkout accepts quantities within remaining stock", () => {
  const lines = [
    {
      pizzaId: 44,
      category: "Pizzas",
      qty: 2,
      directDiscount: { id: 12 },
    },
  ];
  const activeTopDeals = [
    {
      id: 12,
      targetType: "PRODUCT",
      productIds: [44],
      storeIds: [3],
      usageLimit: 5,
      usedCount: 3,
    },
  ];

  assert.equal(
    validateTopDealAvailability(lines, { activeTopDeals, storeId: 3 }),
    null
  );
});

test("top deal checkout rejects quantities above remaining stock", () => {
  const lines = [
    {
      pizzaId: 44,
      category: "Pizzas",
      qty: 3,
      directDiscount: { id: 12 },
    },
  ];
  const activeTopDeals = [
    {
      id: 12,
      targetType: "PRODUCT",
      productIds: [44],
      storeIds: [3],
      usageLimit: 5,
      usedCount: 3,
    },
  ];

  assert.deepEqual(
    validateTopDealAvailability(lines, { activeTopDeals, storeId: 3 }),
    {
      error: "top_deal_quantity_unavailable",
      discountId: 12,
      requestedQuantity: 3,
      remainingQuantity: 2,
    }
  );
});

test("daily top deal quantity uses current date sales only", () => {
  const reference = new Date("2026-09-04T12:00:00.000Z");
  const sales = [
    {
      date: new Date("2026-09-04T10:00:00.000Z"),
      products: [{ directDiscount: { id: 12 }, qty: 3 }],
    },
    {
      date: new Date("2026-09-03T10:00:00.000Z"),
      products: [{ directDiscount: { id: 12 }, qty: 8 }],
    },
  ];
  const totalCounts = getDirectDiscountUsageFromSales(sales, [12]);
  const dailyCounts = getDirectDiscountDailyUsageFromSales(sales, [12], reference);
  const [discount] = attachDirectDiscountUsage(
    [
      {
        id: 12,
        targetType: "PRODUCT",
        productIds: [44],
        storeIds: [3],
        usageLimit: 20,
        value: 40,
        dailyOverrides: [{ date: "2026-09-04", usageLimit: 5 }],
      },
    ],
    { totalCounts, dailyCounts },
    { reference }
  );

  assert.equal(discount.usageLimitScope, "DAILY");
  assert.equal(discount.usageLimit, 5);
  assert.equal(discount.usedCount, 3);
  assert.equal(discount.totalUsedCount, 11);
  assert.equal(discount.remainingQuantity, 2);
  assert.equal(
    validateTopDealAvailability(
      [{ pizzaId: 44, qty: 2, directDiscount: { id: 12 } }],
      { activeTopDeals: [discount], storeId: 3 }
    ),
    null
  );
});

test("base top deal quantity resets on the next day", () => {
  const dayOne = new Date("2026-09-04T12:00:00.000Z");
  const dayTwo = new Date("2026-09-05T12:00:00.000Z");
  const sales = [
    {
      date: new Date("2026-09-04T10:00:00.000Z"),
      products: [{ directDiscount: { id: 12 }, qty: 2 }],
    },
  ];
  const totalCounts = getDirectDiscountUsageFromSales(sales, [12]);
  const [dayOneDiscount] = attachDirectDiscountUsage(
    [
      {
        id: 12,
        targetType: "PRODUCT",
        productIds: [44],
        storeIds: [3],
        usageLimit: 5,
        value: 40,
      },
    ],
    {
      totalCounts,
      dailyCounts: getDirectDiscountDailyUsageFromSales(sales, [12], dayOne),
    },
    { reference: dayOne }
  );
  const [dayTwoDiscount] = attachDirectDiscountUsage(
    [
      {
        id: 12,
        targetType: "PRODUCT",
        productIds: [44],
        storeIds: [3],
        usageLimit: 5,
        value: 40,
      },
    ],
    {
      totalCounts,
      dailyCounts: getDirectDiscountDailyUsageFromSales(sales, [12], dayTwo),
    },
    { reference: dayTwo }
  );

  assert.equal(dayOneDiscount.usageLimitScope, "DAILY");
  assert.equal(dayOneDiscount.usageLimit, 5);
  assert.equal(dayOneDiscount.usedCount, 2);
  assert.equal(dayOneDiscount.remainingQuantity, 3);
  assert.equal(dayTwoDiscount.usageLimitScope, "DAILY");
  assert.equal(dayTwoDiscount.usageLimit, 5);
  assert.equal(dayTwoDiscount.usedCount, 0);
  assert.equal(dayTwoDiscount.totalUsedCount, 2);
  assert.equal(dayTwoDiscount.remainingQuantity, 5);
  assert.equal(
    validateTopDealAvailability(
      [{ pizzaId: 44, qty: 5, directDiscount: { id: 12 } }],
      { activeTopDeals: [dayTwoDiscount], storeId: 3 }
    ),
    null
  );
});

test("today top deal quantity override falls back to base quantity tomorrow", () => {
  const dayOne = new Date("2026-09-04T12:00:00.000Z");
  const dayTwo = new Date("2026-09-05T12:00:00.000Z");
  const sales = [
    {
      date: new Date("2026-09-04T10:00:00.000Z"),
      products: [{ directDiscount: { id: 12 }, qty: 2 }],
    },
  ];
  const totalCounts = getDirectDiscountUsageFromSales(sales, [12]);
  const baseDiscount = {
    id: 12,
    targetType: "PRODUCT",
    productIds: [44],
    storeIds: [3],
    usageLimit: 5,
    value: 40,
    dailyOverrides: [{ date: "2026-09-04", usageLimit: 8 }],
  };
  const [dayOneDiscount] = attachDirectDiscountUsage(
    [baseDiscount],
    {
      totalCounts,
      dailyCounts: getDirectDiscountDailyUsageFromSales(sales, [12], dayOne),
    },
    { reference: dayOne }
  );
  const [dayTwoDiscount] = attachDirectDiscountUsage(
    [baseDiscount],
    {
      totalCounts,
      dailyCounts: getDirectDiscountDailyUsageFromSales(sales, [12], dayTwo),
    },
    { reference: dayTwo }
  );

  assert.equal(dayOneDiscount.usageLimitScope, "DAILY");
  assert.equal(dayOneDiscount.usageLimit, 8);
  assert.equal(dayOneDiscount.usedCount, 2);
  assert.equal(dayOneDiscount.remainingQuantity, 6);
  assert.equal(dayTwoDiscount.usageLimitScope, "DAILY");
  assert.equal(dayTwoDiscount.usageLimit, 5);
  assert.equal(dayTwoDiscount.usedCount, 0);
  assert.equal(dayTwoDiscount.remainingQuantity, 5);
});

test("daily top deal quantity override keeps the base percentage", () => {
  const reference = new Date("2026-09-04T12:00:00.000Z");

  assert.equal(
    getDirectDiscountEffectiveValue(
      {
        value: 40,
        dailyOverrides: [
          { date: "2026-09-04", usageLimit: 5, value: 70 },
        ],
      },
      reference
    ),
    40
  );
});
