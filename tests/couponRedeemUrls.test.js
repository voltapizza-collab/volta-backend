import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrivateCouponSms, resolveCouponFrontendBaseUrl } from "../routes/coupons.js";
import { buildGameCouponSms } from "../routes/games.js";
import { estimateSmsParts } from "../services/telnyx.js";

test("coupon redeem URLs prefer the configured public storefront over local dev URLs", () => {
  const baseUrl = resolveCouponFrontendBaseUrl({
    FRONT_BASE_URL: "http://localhost:3000",
    PUBLIC_FRONTEND_URL: "https://voltapizza.com/",
  });

  assert.equal(baseUrl, "https://voltapizza.com");
});

test("coupon redeem URLs never fall back to localhost for outbound messages", () => {
  const baseUrl = resolveCouponFrontendBaseUrl({
    FRONT_BASE_URL: "http://127.0.0.1:3000",
  });

  assert.equal(baseUrl, "https://voltapizza.com");
});

test("coupon redeem URLs can still use a non-local FRONT_BASE_URL", () => {
  const baseUrl = resolveCouponFrontendBaseUrl({
    FRONT_BASE_URL: "https://example-storefront.com/",
  });

  assert.equal(baseUrl, "https://example-storefront.com");
});

test("private coupon SMS never includes a local redeem URL", () => {
  const text = buildPrivateCouponSms({
    partnerName: "MyCrushPizza",
    coupon: {
      code: "VOL-RC47FGMV",
      kind: "PERCENT",
      percent: 15,
      expiresAt: null,
    },
    redeemUrl: "http://localhost:3000/mycrushpizza/plaza-diario?coupon=VOL-RC47FGMV",
  });

  assert.equal(text.includes("localhost"), false);
  assert.equal(text.includes("Redeem:"), false);
  assert.equal(text.includes("VOL-RC47FGMV"), true);
});

test("private coupon SMS keeps partner name and STOP inside one SMS part", () => {
  const text = buildPrivateCouponSms({
    partnerName: "MyCrushPizza",
    coupon: {
      code: "VOL-RC47FGMV",
      kind: "PERCENT",
      percent: 15,
      expiresAt: null,
    },
    redeemUrl: null,
  });
  const estimate = estimateSmsParts(text);

  assert.equal(text.startsWith("MyCrushPizza:"), true);
  assert.match(text, /\bSTOP$/);
  assert.equal(estimate.parts, 1);
});

test("private coupon SMS keeps public redeem URLs", () => {
  const text = buildPrivateCouponSms({
    partnerName: "MyCrushPizza",
    coupon: {
      code: "VOL-RC47FGMV",
      kind: "PERCENT",
      percent: 15,
      expiresAt: null,
    },
    redeemUrl: "https://voltapizza.com/mycrushpizza/plaza-diario?coupon=VOL-RC47FGMV",
  });

  assert.equal(text.startsWith("MyCrushPizza: Para Ti VOL-RC47FGMV."), true);
  assert.equal(text.includes("https://voltapizza.com/mycrushpizza/plaza-diario?coupon=VOL-RC47FGMV"), true);
  assert.equal(estimateSmsParts(text).parts, 1);
});

test("private coupon SMS keeps the link while falling back to shorter copy", () => {
  const text = buildPrivateCouponSms({
    partnerName: "MyCrushPizzaWithAVeryLongOperationalBrandName",
    coupon: {
      code: "VOL-RC47FGMV",
      kind: "PERCENT",
      percent: 15,
      expiresAt: null,
    },
    redeemUrl:
      "https://voltapizza.com/c/VOL-RC47FGMV",
  });

  assert.equal(text.includes("https://voltapizza.com/c/VOL-RC47FGMV"), true);
  assert.equal(text.includes("VOL-RC47FGMV"), true);
  assert.equal(estimateSmsParts(text).parts, 1);
});

test("game coupon SMS keeps partner name and STOP inside one SMS part", () => {
  const text = buildGameCouponSms({
    partnerName: "MyCrushPizza",
    couponCode: "VOL-GAME77",
  });
  const estimate = estimateSmsParts(text);

  assert.equal(text, "MyCrushPizza: premio VOL-GAME77. STOP");
  assert.equal(estimate.parts, 1);
});
