import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import express from "express";
import crypto from "node:crypto";
import checkoutRoutes from "../routes/checkout.js";
import couponsRoutes from "../routes/coupons.js";
import { lockCheckoutCoupon, reserveCouponForSale, releaseCouponReservation } from "../services/couponReservations.js";
import { createCouponRedemptionsForSale } from "../routes/checkout.js";

// Never fall back to the application's DATABASE_URL: this test writes fixtures.
const url = process.env.COUPON_TEST_DATABASE_URL;
test("MySQL: concurrent allocation, duplicate consumption, release and unlimited counters", { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/coupon_flow_test");
  const require = createRequire(import.meta.url);
  const { PrismaClient } = require(process.env.COUPON_TEST_CLIENT || "@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const suffix = Date.now().toString();
  const partner = await prisma.partner.create({ data: { name: "Coupon test", slug: "coupon-test-" + suffix, country: "ES", currency: "EUR" } });
  const store = await prisma.store.create({ data: { partnerId: partner.id, slug: "test", storeName: "Test", address: "Test" } });
  t.after(async () => {
    await prisma.couponRedemption.deleteMany({ where: { partnerId: partner.id } });
    await prisma.sale.deleteMany({ where: { partnerId: partner.id } });
    await prisma.customer.deleteMany({ where: { partnerId: partner.id } });
    await prisma.coupon.deleteMany({ where: { partnerId: partner.id } });
    await prisma.store.delete({ where: { id: store.id } });
    await prisma.partner.delete({ where: { id: partner.id } });
    await prisma.$disconnect();
  });
  const limited = await prisma.coupon.create({ data: { partnerId: partner.id, code: "LIMIT-" + suffix, kind: "AMOUNT", amount: "5", usageLimit: 1 } });
  let serial = 0;
  const saleData = coupon => ({ partnerId: partner.id, storeId: store.id, code: suffix + "-" + ++serial,
    type: "WEB_ORDER", delivery: "PICKUP", products: [{ type: "COUPON", couponCode: coupon.code, subtotal: -5 }],
    totalProducts: 12, discounts: 5, total: 7, status: "AWAITING_PAYMENT" });
  const allocate = coupon => prisma.$transaction(async tx => {
    const locked = await lockCheckoutCoupon(tx, { partnerId: partner.id, code: coupon.code, eligibleSubtotal: 12, store });
    const sale = await tx.sale.create({ data: saleData(coupon) });
    await reserveCouponForSale(tx, locked.coupon, sale);
    return sale;
  }, { maxWait: 20000, timeout: 20000 });
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => allocate(limited)));
  assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
  assert.ok(attempts.filter(r => r.status === "rejected").every(r => r.reason.message === "coupon_reserved"));
  const heldSale = attempts.find(r => r.status === "fulfilled").value;
  await releaseCouponReservation(prisma, { id: "expired", payment_status: "unpaid", metadata: { purpose: "order_checkout", saleId: String(heldSale.id) } });
  const paidSale = await allocate(limited);
  const consume = sale => prisma.$transaction(tx => createCouponRedemptionsForSale(tx, sale), { maxWait: 20000, timeout: 20000 });
  await Promise.all(Array.from({ length: 12 }, () => consume(paidSale)));
  assert.equal(await prisma.couponRedemption.count({ where: { saleId: paidSale.id } }), 1);
  assert.equal((await prisma.coupon.findUnique({ where: { id: limited.id } })).usedCount, 1);
  assert.equal((await prisma.couponReservation.findUnique({ where: { saleId: paidSale.id } })).status, "CONSUMED");
  await assert.rejects(allocate(limited), /coupon_not_applicable/);

  const unlimited = await prisma.coupon.create({ data: { partnerId: partner.id, code: "UNLIMIT-" + suffix, kind: "AMOUNT", amount: "5", usageUnlimited: true } });
  const sales = await Promise.all(Array.from({ length: 12 }, () => allocate(unlimited)));
  await Promise.all(sales.map(consume));
  assert.equal((await prisma.coupon.findUnique({ where: { id: unlimited.id } })).usedCount, 12);
  assert.equal(await prisma.couponRedemption.count({ where: { couponId: unlimited.id } }), 12);
  assert.equal(await prisma.couponReservation.count({ where: { couponId: unlimited.id } }), 0);

  const app = express();
  app.use(express.json()); app.use("/coupons", couponsRoutes(prisma)); app.use("/checkout", checkoutRoutes(prisma));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const request = { partnerId: partner.id, storeId: store.id, code: unlimited.code };
  const preview = await post("/coupons/validate", { ...request, cart: [{ type: "PROMO", subtotal: 12 }] });
  assert.equal(preview.body.status, "no_eligible_products");
  const mixed = [{ pizzaId: 1, subtotal: 12, qty: 1 }, { type: "PROMO", subtotal: 8, qty: 1 }];
  const ready = await post("/coupons/validate", { ...request, cart: mixed, subtotal: 9999 });
  assert.equal(ready.body.subtotal, 12); assert.equal(ready.body.discount, 5);
  await prisma.partner.update({ where: { id: partner.id }, data: { minimumPaymentAmount: 10, paymentPolicySettings: { cash: true } } });
  const checkout = { partnerId: partner.id, storeId: store.id, paymentMode: "cash", delivery: { method: "PICKUP" },
    cart: [mixed[0], { type: "COUPON", couponCode: unlimited.code, subtotal: -5 }] };
  const blocked = await post("/checkout/session", checkout);
  assert.equal(blocked.status, 400); assert.equal(blocked.body.error, "minimum_payment_not_met");
  // At the exact boundary, minimum payment passes and the next required step is the customer profile.
  const boundary = await post("/checkout/session", { ...checkout, cart: [{ ...mixed[0], subtotal: 15 }, checkout.cart[1]] });
  assert.equal(boundary.body.error, "customer_profile_required");

  const customer = { name: "Cliente prueba", phone: "600000001" };
  const cash = await post("/checkout/session", { ...checkout, customer, cart: [{ ...mixed[0], subtotal: 15 }, checkout.cart[1]] });
  assert.equal(cash.status, 200);
  assert.equal(await prisma.couponRedemption.count({ where: { saleId: cash.body.saleId } }), 1);

  const cardCoupon = await prisma.coupon.create({ data: { partnerId: partner.id, code: "CARD-" + suffix, kind: "AMOUNT", amount: "5" } });
  const previousFetch = globalThis.fetch, previousKey = process.env.STRIPE_SECRET_KEY, previousWebhook = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_SECRET_KEY = "sk_test_local"; process.env.STRIPE_WEBHOOK_SECRET = "whsec_local";
  let session, rejectCreation = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://api.stripe.com/")) {
      if (rejectCreation) return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: "test_rejection" } }) };
      const params = new URLSearchParams(options.body);
      session = { id: "cs_local_" + params.get("metadata[saleId]"), url: "https://example.test/pay", payment_status: "unpaid",
        metadata: { purpose: "order_checkout", saleId: params.get("metadata[saleId]") } };
      return { ok: true, text: async () => JSON.stringify(session) };
    }
    assert.ok(String(url).startsWith("http://127.0.0.1:"), "No external services are permitted in this test");
    return previousFetch(url, options);
  };
  try {
    const payload = { ...checkout, customer, paymentMode: "card", cart: [{ ...mixed[0], subtotal: 15 }, { ...checkout.cart[1], couponCode: cardCoupon.code }] };
    const card = await post("/checkout/session", payload);
    assert.equal(card.status, 200);
    assert.equal(await prisma.couponRedemption.count({ where: { saleId: card.body.saleId } }), 0);
    const second = await post("/checkout/session", payload);
    assert.equal(second.body.error, "coupon_reserved");
    const body = JSON.stringify({ type: "checkout.session.expired", data: { object: { ...session, status: "expired" } } });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac("sha256", "whsec_local").update(timestamp + "." + body).digest("hex");
    const expiry = await fetch(`http://127.0.0.1:${server.address().port}/checkout/stripe/webhook`, {
      method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` }, body });
    assert.equal(expiry.status, 200);
    assert.equal((await prisma.couponReservation.findUnique({ where: { saleId: card.body.saleId } })).status, "RELEASED");
    rejectCreation = true;
    await post("/checkout/session", payload);
    assert.equal(await prisma.couponReservation.count({ where: { couponId: cardCoupon.id, status: "RESERVED" } }), 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = previousKey;
    if (previousWebhook == null) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = previousWebhook;
  }
});
