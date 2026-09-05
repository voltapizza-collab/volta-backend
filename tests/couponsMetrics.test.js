import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import couponsRoutes from "../routes/coupons.js";

test("offer metrics loads promos and top deals with model-safe fields", async (t) => {
  let promoFindManyArgs = null;
  let directDiscountFindManyArgs = null;

  const prisma = {
    $queryRawUnsafe: async () => [{ Field: "present" }],
    $executeRawUnsafe: async () => assert.fail("metrics should not create columns in this test"),
    coupon: {
      count: async () => 0,
      findMany: async () => [],
    },
    couponRedemption: {
      findMany: async () => [],
    },
    promo: {
      findMany: async (args) => {
        promoFindManyArgs = args;
        return [];
      },
    },
    directDiscount: {
      findMany: async (args) => {
        directDiscountFindManyArgs = args;
        return [];
      },
    },
    incentive: {
      findMany: async () => [],
    },
    sale: {
      findMany: async () => [],
    },
  };

  const app = express();
  app.use(express.json());
  app.use(couponsRoutes(prisma));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/metrics?partnerId=1`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(promoFindManyArgs.select.usageLimit, undefined);
  assert.equal(promoFindManyArgs.select.dailyOverrides, undefined);
  assert.equal(directDiscountFindManyArgs.select.usageLimit, true);
  assert.equal(directDiscountFindManyArgs.select.dailyOverrides, true);
});
