import assert from 'node:assert/strict';
import { test } from 'node:test';
import { individualQrCouponData, normalizeClaimPhone, isDeliveryClaimQr, claimCampaignAvailable, assertQrCouponCustomer, qrClaimClientIp, QR_CLAIM_TERMS_VERSION } from '../services/couponQrClaims.js';
import { evaluateCoupon } from '../services/couponEvaluation.js';
import { buildPrivateCouponSms } from '../routes/coupons.js';
import { isPublicWebRoute } from '../services/webAccess.js';
import { estimateSmsParts } from '../services/telnyx.js';

const parent = { id: 1, partnerId: 2, code: 'QR', campaign: 'CHANNEL_SHIFT', status: 'ACTIVE',
  meta: { qrBenefit: 'DELIVERY_FREE', claimValidityDays: 30, targeting: { storeIds: [4], zipCodes: ['28001'] } } };
const now = new Date('2026-10-09T14:23:00Z');

test('Railway QR rate limits use the ingress client address without trusting local headers', () => {
  const request = value => ({ ip: '10.0.0.1', get: () => value });
  const railway = { RAILWAY_DEPLOYMENT_ID: 'deployment' };
  assert.equal(qrClaimClientIp(request('203.0.113.1'), railway), '203.0.113.1');
  assert.equal(qrClaimClientIp(request('2001:db8::1'), railway), '2001:db8::1');
  assert.equal(qrClaimClientIp(request('203.0.113.1'), {}), '10.0.0.1');
  for (const value of [undefined, '', '203.0.113.1, 10.0.0.1', 'not-an-ip']) {
    assert.equal(qrClaimClientIp(request(value), railway), '10.0.0.1');
  }
});

test('all Spanish phone variants share an identity; invalid phones are rejected', () => {
  for (const value of ['600 123 456', '+34 600123456', '34600123456', '0034 600-123-456']) assert.equal(normalizeClaimPhone(value), '+34600123456');
  for (const value of ['123', '+33600123456', '123456789', null]) assert.equal(normalizeClaimPhone(value), null);
});
test('claim QR cannot be spent, while old shared QR discounts still work', () => {
  assert.equal(isDeliveryClaimQr(parent), true);
  assert.equal(evaluateCoupon(parent, { deliveryFee: 3 }).status, 'claim_required');
  assert.equal(evaluateCoupon({ ...parent, meta: {}, kind: 'AMOUNT', amount: 5, usageUnlimited: true }, { eligibleSubtotal: 12 }).discount, 5);
  assert.equal(claimCampaignAvailable(parent, now), true);
  assert.equal(claimCampaignAvailable({ ...parent, expiresAt: now }, now), false);
  assert.equal(claimCampaignAvailable({ ...parent, status: 'DISABLED' }, now), false);
});
test('15/20/30 days are individual instants across DST and independent of campaign end', () => {
  for (const days of [15, 20, 30]) {
    const coupon = individualQrCouponData({ ...parent, expiresAt: now, meta: { ...parent.meta, claimValidityDays: days } }, { id: 7 }, '+34600123456', now);
    assert.equal(coupon.expiresAt.getTime() - now.getTime(), days * 86400000);
    assert.equal(coupon.usageLimit, 1); assert.equal(coupon.usageUnlimited, false);
    assert.equal(coupon.sourceQrId, parent.id); assert.equal(coupon.assignedToId, 7);
    assert.equal(coupon.meta.termsVersion, QR_CLAIM_TERMS_VERSION);
    assert.match(coupon.code, /^VOL-DF[A-Z2-9]{10}$/);
    assert.equal(evaluateCoupon(coupon, { reference: now, deliveryFee: 3, store: { id: 4 } }).discount, 3);
    assert.equal(evaluateCoupon(coupon, { reference: now, deliveryFee: 3, store: { id: 5, zipCode: '28001' } }).status, 'wrong_area');
    assert.equal(evaluateCoupon(coupon, { reference: now, deliveryFee: 0, store: { id: 4 } }).valid, false);
    assert.equal(evaluateCoupon(coupon, { reference: coupon.expiresAt, deliveryFee: 3, store: { id: 4 } }).status, 'expired');
  }
});
test('checkout requires the recipient phone even with a supplied customer id', () => {
  const coupon = individualQrCouponData(parent, { id: 7 }, '+34600123456', now);
  assert.doesNotThrow(() => assertQrCouponCustomer(coupon, { phone: '600123456' }));
  for (const customer of [{ id: 7 }, { id: 7, phone: '600111222' }])
    assert.throws(() => assertQrCouponCustomer(coupon, customer), /coupon_customer_mismatch/);
  assert.doesNotThrow(() => assertQrCouponCustomer({ code: 'OLD' }, {}));
});
test('requested SMS states benefit and expiry and keeps the private short link', () => {
  const coupon = individualQrCouponData(parent, { id: 7 }, '+34600123456', now);
  const url = `https://voltapizza.com/c/${coupon.code}`;
  const text = buildPrivateCouponSms({ partnerName: 'Pizzeria', coupon, redeemUrl: url });
  assert.match(text, /envio gratis/i); assert.match(text, /1 uso/); assert.match(text, /08\/11\/26/); assert.ok(text.includes(url));
  assert.equal(estimateSmsParts(buildPrivateCouponSms({ partnerName: 'Pizzería 🍕 con un nombre muy largo para SMS', coupon, redeemUrl: url })).parts, 1);
});
test('public claim route does not expose QR management writes', () => {
  assert.equal(isPublicWebRoute('POST', '/coupons/qr-claim/QR'), true);
  for (const [method, path] of [['POST', '/coupons/channel-shift-qr'], ['PATCH', '/coupons/channel-shift-qr/1/stop'], ['DELETE', '/coupons/channel-shift-qr/1']])
    assert.equal(isPublicWebRoute(method, path), false);
});
