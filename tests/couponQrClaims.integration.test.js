import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import express from 'express';
import couponsRoutes from '../routes/coupons.js';
import checkoutRoutes from '../routes/checkout.js';
import { claimDeliveryQr, consumeQrClaimAttempt, writeQrMessageMeta, QR_CLAIM_TERMS_VERSION } from '../services/couponQrClaims.js';

const url = process.env.COUPON_TEST_DATABASE_URL;
test('MySQL: reusable delivery QR lifecycle, concurrency, recovery, ownership and checkout', { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
  assert.equal(target.pathname, '/coupon_flow_test');
  const require = createRequire(import.meta.url);
  const { PrismaClient } = require(process.env.COUPON_TEST_CLIENT || '@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  // This explicitly isolated database must not retain rate limits between runs.
  await prisma.couponClaimThrottle.deleteMany();
  const suffix = crypto.randomBytes(5).toString('hex').toUpperCase();
  const partner = await prisma.partner.create({ data: { name: 'QR Test', slug: `qr-${suffix}`, country: 'ES', currency: 'EUR',
    deliveryPricingMode: 'FIXED', deliveryFeeFixed: 2.5, minimumPaymentAmount: 10, paymentPolicySettings: { cash: true } } });
  const store = await prisma.store.create({ data: { partnerId: partner.id, slug: 'shop', storeName: 'QR Shop', address: 'Test 1', zipCode: '28001' } });
  const other = await prisma.store.create({ data: { partnerId: partner.id, slug: 'other', storeName: 'Other', address: 'Test 2', zipCode: '28001' } });
  const product = await prisma.menuPizza.create({ data: { partnerId: partner.id, name: 'Pizza Test', type: 'SELLABLE', status: 'ACTIVE', selectSize: ['M'], priceBySize: { M: 12 }, stocks: { create: { storeId: store.id, active: true } } } });
  t.after(async () => {
    await prisma.couponRedemption.deleteMany({ where: { partnerId: partner.id } });
    await prisma.sale.deleteMany({ where: { partnerId: partner.id } });
    await prisma.coupon.deleteMany({ where: { partnerId: partner.id, sourceQrId: { not: null } } });
    await prisma.coupon.deleteMany({ where: { partnerId: partner.id } });
    await prisma.customer.deleteMany({ where: { partnerId: partner.id } });
    await prisma.store.deleteMany({ where: { partnerId: partner.id } });
    await prisma.menuPizza.deleteMany({ where: { partnerId: partner.id } });
    await prisma.partner.delete({ where: { id: partner.id } });
    await prisma.couponClaimThrottle.deleteMany();
    await prisma.$disconnect();
  });
  const sent = [];
  const send = async (coupon, recipient) => {
    sent.push({ code: coupon.code, phone: recipient.phone });
    await prisma.coupon.update({ where: { id: coupon.id }, data: { meta: { ...coupon.meta, messageStatus: 'sent' } } });
    return { ok: true, status: 'sent' };
  };
  const app = express(); app.use(express.json());
  app.use('/coupons', couponsRoutes(prisma, { sendQrSms: (_db, { coupon, recipient }) => send(coupon, recipient) }));
  app.use('/checkout', checkoutRoutes(prisma));
  app.use('/default-coupons', couponsRoutes(prisma));
  const failingStatsClient = prisma.$extends({ query: { coupon: {
    count() { throw new Error('Simulated QR statistics failure'); },
  } } });
  app.use('/failing-coupons', couponsRoutes(failingStatsClient));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  await t.test('creation rolls back when preparing the response fails and can be retried', async () => {
    const payload = { partnerId: partner.id, storeIds: [store.id], code: `ATOMIC_${suffix}`,
      campaignName: 'Atomic QR', benefitType: 'DELIVERY_FREE', claimValidityDays: 30 };
    const failed = await request('/failing-coupons/channel-shift-qr', payload);
    assert.equal(failed.status, 500);
    assert.equal(await prisma.coupon.findUnique({ where: { code: payload.code } }), null);
    const retried = await request('/coupons/channel-shift-qr', payload);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.coupon.claimStats.issued, 0);
    assert.equal(await prisma.coupon.count({ where: { code: payload.code } }), 1);
  });
  const created = await request('/coupons/channel-shift-qr', { partnerId: partner.id, storeIds: [store.id], campaignName: `DELIVERY_${suffix}`, benefitType: 'DELIVERY_FREE', claimValidityDays: 30 });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const parent = created.body.coupon;
  assert.equal(parent.benefitType, 'DELIVERY_FREE'); assert.equal(parent.expiresAt, null);
  const resolved = await request(`/coupons/resolve-link/${parent.code}`, null, 'GET');
  assert.equal(resolved.body.mode, 'claim'); assert.equal(resolved.body.redeemUrl, undefined);
  const premature = await request('/coupons/validate', { partnerId: partner.id, storeId: store.id, code: parent.code, deliveryFee: 2.5 });
  assert.equal(premature.body.status, 'claim_required');
  const now = new Date();
  const claim = { code: parent.code, name: 'Cliente', phone: '600101010', termsVersion: QR_CLAIM_TERMS_VERSION, now };
  const attempts = await Promise.all(Array.from({ length: 12 }, () => claimDeliveryQr(prisma, claim, send)));
  assert.equal(sent.length, 1);
  assert.equal(attempts.filter(row => row.delivery.sentNow).length, 1);
  assert.equal(attempts.filter(row => !row.recovered).length, 1);
  for (const result of attempts) { assert.equal(result.coupon, undefined); assert.equal(result.customer, undefined); assert.equal(result.delivery.redeemUrl, undefined); }
  let coupon = await prisma.coupon.findFirst({ where: { sourceQrId: parent.id } });
  const expiry = coupon.expiresAt.toISOString();
  const attemptAt = coupon.meta.qrSmsAttemptAt;
  await writeQrMessageMeta(prisma, coupon.id, { messageStatus: 'delivered', message: {
    providerMessageId: 'test-message', status: 'delivered', finalizedAt: now.toISOString(), updatedAt: now.toISOString(), eventType: 'message.finalized',
  } });
  await writeQrMessageMeta(prisma, coupon.id, { messageStatus: 'queued', message: {
    providerMessageId: 'test-message', status: 'queued', updatedAt: new Date(now.getTime() + 1000).toISOString(),
  } });
  const finalized = await prisma.coupon.findUnique({ where: { id: coupon.id } });
  assert.equal(finalized.meta.messageStatus, 'delivered'); assert.equal(finalized.meta.qrSmsAttemptAt, attemptAt);
  assert.equal(await prisma.coupon.count({ where: { sourceQrId: parent.id } }), 1);
  assert.equal((await prisma.customer.findUnique({ where: { id: coupon.assignedToId } })).marketingSuppressed, true);
  await assert.rejects(prisma.coupon.create({ data: { partnerId: partner.id, code: `DUP-${suffix}`, sourceQrId: parent.id, claimPhone: '+34600101010' } }), error => error.code === 'P2002');
  const smsLink = await request(`/coupons/resolve-link/${coupon.code}`, null, 'GET');
  assert.ok(smsLink.body.redeemUrl.includes(`/${partner.slug}/shop?coupon=`));
  const wrongStore = await request('/coupons/validate', { partnerId: partner.id, storeId: other.id, code: coupon.code, deliveryFee: 2.5 });
  assert.equal(wrongStore.body.status, 'wrong_area');

  await request(`/coupons/channel-shift-qr/${parent.id}/stop`, { partnerId: partner.id }, 'PATCH');
  await assert.rejects(claimDeliveryQr(prisma, { ...claim, phone: '600202020' }, send), /campaign_unavailable/);
  const recovered = await claimDeliveryQr(prisma, { ...claim, phone: '+34 600101010', resend: true, now: new Date(now.getTime() + 121000) }, send);
  assert.equal(recovered.recovered, true); assert.equal(sent.length, 1, 'resend=true cannot spend another SMS');
  assert.deepEqual(recovered.delivery, { sent: true, sentNow: false, status: 'delivered' });
  assert.equal(new Date(recovered.expiresAt).toISOString(), expiry);
  const blockedDelete = await request(`/coupons/channel-shift-qr/${parent.id}`, { partnerId: partner.id, confirmCode: parent.code }, 'DELETE');
  assert.equal(blockedDelete.status, 409); assert.equal(blockedDelete.body.claimCount, 1);

  const payload = { partnerId: partner.id, storeId: store.id, paymentMode: 'cash',
    customer: { name: 'Cliente', phone: '600101010' }, delivery: { method: 'COURIER', address: 'Test 1', deliveryFee: 2.5 },
    cart: [{ pizzaId: product.id, size: 'M', qty: 1, price: 12, subtotal: 12 }, { type: 'COUPON', couponCode: coupon.code, subtotal: -2.5 }] };
  const wrongOwner = await request('/checkout/session', { ...payload, customer: { id: coupon.assignedToId, phone: '600303030' } });
  assert.equal(wrongOwner.body.error, 'coupon_customer_mismatch', JSON.stringify(wrongOwner));
  const checkout = await request('/checkout/session', payload);
  assert.equal(checkout.status, 200, JSON.stringify(checkout)); assert.equal(checkout.body.total, 12);
  coupon = await prisma.coupon.findUnique({ where: { id: coupon.id } });
  assert.equal(coupon.status, 'USED'); assert.equal(coupon.usedCount, 1);
  await assert.rejects(claimDeliveryQr(prisma, claim, send), /coupon_already_used/);
  const secondCheckout = await request('/checkout/session', payload);
  assert.equal(secondCheckout.status, 409);

  await request(`/coupons/channel-shift-qr/${parent.id}/reactivate`, { partnerId: partner.id }, 'PATCH');
  const failedPhone = '600404040';
  const failure = await claimDeliveryQr(prisma, { ...claim, phone: failedPhone }, async c => {
    await prisma.coupon.update({ where: { id: c.id }, data: { meta: { ...c.meta, messageStatus: 'failed' } } });
    return { ok: false, status: 'failed' };
  });
  assert.equal(failure.delivery.sent, false);
  assert.equal(failure.delivery.sentNow, false);
  const retry = await claimDeliveryQr(prisma, { ...claim, phone: failedPhone, now: new Date(now.getTime() + 121000) }, send);
  assert.equal(retry.delivery.sent, false); assert.equal(retry.delivery.status, 'failed'); assert.equal(retry.recovered, true);
  const sendsBeforeLateRetry = sent.length;
  await claimDeliveryQr(prisma, { ...claim, phone: failedPhone, resend: true, now: new Date(now.getTime() + 86400000) }, send);
  assert.equal(sent.length, sendsBeforeLateRetry, 'even a failed attempt cannot be resent the next day');
  const expiring = await prisma.coupon.findFirst({ where: { sourceQrId: parent.id, claimPhone: '+34600404040' } });
  await prisma.coupon.update({ where: { id: expiring.id }, data: { expiresAt: new Date(now.getTime() - 1) } });
  await assert.rejects(claimDeliveryQr(prisma, { ...claim, phone: failedPhone }, send), /coupon_expired/);
  const viaHttp = await request(`/coupons/qr-claim/${parent.code}`, { name: 'Nuevo', phone: '600505050', termsVersion: QR_CLAIM_TERMS_VERSION });
  assert.equal(viaHttp.status, 200); assert.equal(viaHttp.body.coupon, undefined); assert.equal(viaHttp.body.delivery.sent, true);
  assert.equal(viaHttp.body.delivery.sentNow, true);
  const listing = await request(`/coupons/channel-shift-qr?partnerId=${partner.id}`, null, 'GET');
  assert.equal(listing.body.items[0].claimStats.issued, 3); assert.equal(listing.body.items[0].claimStats.redeemed, 1);
  assert.equal(listing.body.items[0].qrViewCount, 1);
  assert.equal(listing.body.items[0].claimStats.shippingDiscountTotal, 2.5);
  assert.equal(listing.body.items[0].claimStats.newCustomers, 3);
  assert.equal(listing.body.items[0].claimStats.existingCustomers, 0);
  assert.equal(listing.body.items[0].claimStats.unclassifiedCustomers, 0);
  assert.equal(listing.body.items[0].claimStats.smsSent, 2);
  // Default sender stops at the disabled business service; it must preserve the coupon without contacting Telnyx.
  const disabledSms = await request(`/default-coupons/qr-claim/${parent.code}`, { name: 'Sin SMS', phone: '600606060', termsVersion: QR_CLAIM_TERMS_VERSION });
  assert.equal(disabledSms.status, 200); assert.equal(disabledSms.body.delivery.sent, false);
  const pendingCoupon = await prisma.coupon.findFirst({ where: { sourceQrId: parent.id, claimPhone: '+34600606060' } });
  assert.equal(pendingCoupon.meta.messageStatus, 'skipped');
  assert.equal(pendingCoupon.meta.message.error.title, 'sms_service_disabled');
  const failedListing = await request(`/coupons/channel-shift-qr?partnerId=${partner.id}`, null, 'GET');
  assert.equal(failedListing.body.items[0].claimStats.smsFailed, 2);
  assert.equal(failedListing.body.items[0].claimStats.newCustomers, 4, 'SMS failure must not undo the customer registration');
  await t.test('existing formatted phones and simultaneous campaigns do not duplicate customers or new-customer counts', async () => {
    const existing = await prisma.customer.create({ data: { partnerId: partner.id, code: `EXISTING-${suffix}`,
      name: 'Existing profile', phone: '+34 600-707-070', address_1: 'Existing address', marketingSuppressed: false } });
    await claimDeliveryQr(prisma, { ...claim, name: 'Different name', phone: '600707070' }, send);
    const existingCoupon = await prisma.coupon.findFirst({ where: { sourceQrId: parent.id, claimPhone: '+34600707070' } });
    assert.equal(existingCoupon.assignedToId, existing.id);
    assert.equal(existingCoupon.meta.qrCustomerCreated, false);
    const profile = await prisma.customer.findUnique({ where: { id: existing.id } });
    assert.equal(profile.name, 'Existing profile');
    assert.equal(profile.address_1, 'Existing address');
    assert.equal(profile.marketingSuppressed, false);
    const another = await request('/coupons/channel-shift-qr', { partnerId: partner.id, storeIds: [store.id], campaignName: `SECOND_${suffix}`, benefitType: 'DELIVERY_FREE' });
    await Promise.all([parent.code, another.body.coupon.code].map(code => claimDeliveryQr(prisma, { ...claim, code, phone: '600808080' }, send)));
    const shared = await prisma.coupon.findMany({ where: { partnerId: partner.id, claimPhone: '+34600808080' } });
    assert.equal(shared.length, 2);
    assert.equal(new Set(shared.map(c => c.assignedToId)).size, 1);
    assert.equal(shared.filter(c => c.meta.qrCustomerCreated).length, 1);
    assert.equal(await prisma.customer.count({ where: { partnerId: partner.id, phone: '+34600808080' } }), 1);
    const stats = (await request(`/coupons/channel-shift-qr?partnerId=${partner.id}`, null, 'GET')).body.items;
    assert.equal(stats.reduce((sum, item) => sum + item.claimStats.newCustomers, 0), 5);
    assert.equal(stats.reduce((sum, item) => sum + item.claimStats.existingCustomers, 0), 2);
    // A legacy claim without stored provenance must not be guessed to be a new customer.
    const legacyMeta = { ...existingCoupon.meta }; delete legacyMeta.qrCustomerCreated;
    await prisma.coupon.update({ where: { id: existingCoupon.id }, data: { meta: legacyMeta } });
    const legacyStats = (await request(`/coupons/channel-shift-qr?partnerId=${partner.id}`, null, 'GET')).body.items.find(item => item.id === parent.id).claimStats;
    assert.equal(legacyStats.unclassifiedCustomers, 1);
  });
  const throttle = await Promise.all(Array.from({ length: 8 }, () => consumeQrClaimAttempt(prisma, { ip: `test-${suffix}`, phone: `test-${suffix}` })));
  assert.equal(throttle.filter(Boolean).length, 5);
});
