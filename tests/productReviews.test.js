import test from "node:test";
import assert from "node:assert/strict";
import { estimateSmsParts } from "../services/telnyx.js";
import {
  buildProductReviewRequestSms,
  getReviewItemsFromSale,
  isReviewableProductName,
} from "../services/productReviews.js";

test("product reviews include only purchased reviewable food products", () => {
  const items = getReviewItemsFromSale({
    products: [
      { id: 1, pizzaId: 10, name: "BBQ", price: 12, subtotal: 12, quantity: 1 },
      { cartLineId: "coupon-VOL-RC123", source: "coupon", name: "Cupon VOL-RC123", price: -3, subtotal: -3 },
      { id: 2, name: "Coca-Cola", type: "DRINK", price: 2, subtotal: 2 },
      { id: 3, name: "Agua", price: 1.5, subtotal: 1.5 },
      { id: 4, name: "Queue boost", source: "queue_boost", price: 0.2, subtotal: 0.2 },
      {
        id: 5,
        name: "Promo familiar",
        source: "promo",
        price: 20,
        subtotal: 20,
        promoItems: [
          { pizzaId: 11, name: "Jamon York", price: 9, subtotal: 9 },
          { id: 12, name: "Fanta naranja", type: "DRINK", price: 2, subtotal: 2 },
        ],
      },
    ],
  });

  assert.deepEqual(
    items.map((item) => item.name),
    ["BBQ", "Jamon York"]
  );
});

test("product review analytics name filter excludes non-product labels", () => {
  assert.equal(isReviewableProductName("Cupon VOL-RCUUAEXK"), false);
  assert.equal(isReviewableProductName("Bebida cola"), false);
  assert.equal(isReviewableProductName("Sweet Hawaiian"), true);
});

test("product review SMS keeps the review request inside one SMS part", () => {
  const reviewUrl = "https://voltapizza.com/review/4TW6YB-Wq_GbCHegOBwtjGCe";
  const text = buildProductReviewRequestSms({
    partnerName: "MyCrushPizza",
    reviewUrl,
  });

  assert.equal(text, `MyCrushPizza: valora tu pedido: ${reviewUrl}`);
  assert.equal(estimateSmsParts(text).parts, 1);
});

test("product review SMS falls back when the partner name is too long", () => {
  const reviewUrl = "https://voltapizza.com/review/4TW6YB-Wq_GbCHegOBwtjGCe";
  const text = buildProductReviewRequestSms({
    partnerName: "Pizzeria familiar artesanal con un nombre comercial demasiado largo para un SMS corto ".repeat(3),
    reviewUrl,
  });

  assert.equal(text, `Valora tu pedido: ${reviewUrl}`);
  assert.equal(estimateSmsParts(text).parts, 1);
});
