import crypto from 'node:crypto';
import { isIP } from 'node:net';

// Railway's public HTTP ingress supplies X-Real-IP. Never trust it locally.
// https://docs.railway.com/networking/public-networking/specs-and-limits
export const qrClaimClientIp = (req, env = process.env) => {
  const forwarded = req.get?.('x-real-ip');
  return env.RAILWAY_DEPLOYMENT_ID && typeof forwarded === 'string' && isIP(forwarded)
    ? forwarded : req.ip;
};

export const QR_CLAIM_TERMS_VERSION = 'qr-delivery-2026-10-v1';
export const couponMeta = coupon => {
  try { return typeof coupon?.meta === 'string' ? JSON.parse(coupon.meta) : coupon?.meta || {}; }
  catch { return {}; }
};
export const isDeliveryClaimQr = coupon => coupon?.campaign === 'CHANNEL_SHIFT' && couponMeta(coupon).qrBenefit === 'DELIVERY_FREE';
export const normalizeClaimPhone = value => {
  const digits = String(value || '').replace(/[^\d]/g, '').replace(/^0034/, '34');
  if (/^[6789]\d{8}$/.test(digits)) return `+34${digits}`;
  if (/^34[6789]\d{8}$/.test(digits)) return `+${digits}`;
  return null;
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const options = { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 20000 };
export const claimCampaignAvailable = (coupon, now = new Date()) => isDeliveryClaimQr(coupon) &&
  coupon.status === 'ACTIVE' && (!coupon.activeFrom || new Date(coupon.activeFrom) <= now) &&
  (!coupon.expiresAt || new Date(coupon.expiresAt) > now);

// Shared by all API instances. No raw IP addresses are stored.
export async function consumeQrClaimAttempt(prisma, { ip, phone, now = new Date() }) {
  const limits = [
    { value: `ip:${ip || 'unknown'}`, max: 30, duration: 15 * 60000 },
    ...(phone ? [{ value: `phone:${phone}`, max: 5, duration: 3600000 }] : []),
  ].map(item => ({ ...item, key: crypto.createHash('sha256').update(item.value).digest('hex') }))
    .sort((a, b) => a.key.localeCompare(b.key));
  await prisma.couponClaimThrottle.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86400000) } } });
  return prisma.$transaction(async tx => {
    let allowed = true;
    for (const item of limits) {
      // Prisma 5's emulated upsert can race on an absent row. Let MySQL allocate atomically.
      await tx.$executeRawUnsafe(`INSERT INTO CouponClaimThrottle (\`key\`, attempts, expiresAt) VALUES (?, 1, ?)
        ON DUPLICATE KEY UPDATE attempts = IF(expiresAt <= ?, 1, attempts + 1),
        expiresAt = IF(expiresAt <= ?, VALUES(expiresAt), expiresAt)`, item.key, new Date(now.getTime() + item.duration), now, now);
      const row = await tx.couponClaimThrottle.findUnique({ where: { key: item.key } });
      if (row.attempts > item.max) allowed = false;
    }
    return allowed;
  }, options);
}

export function assertQrCouponCustomer(coupon, customer) {
  if (!coupon?.sourceQrId) return;
  if (!coupon.claimPhone || normalizeClaimPhone(customer?.phone) !== coupon.claimPhone)
    throw fail(409, 'coupon_customer_mismatch');
}

// Provider callbacks can arrive before the send response.
// Merge under the same coupon lock so a stale message cannot erase the attempt marker.
export async function writeQrMessageMeta(prisma, couponId, patch) {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRawUnsafe('SELECT * FROM Coupon WHERE id = ? FOR UPDATE', couponId);
    if (!rows[0]) return null;
    const meta = couponMeta(rows[0]);
    const incoming = patch.message || {}, current = meta.message || {};
    const sameMessage = incoming.providerMessageId && incoming.providerMessageId === current.providerMessageId;
    const staleEvent = incoming.eventType && new Date(incoming.updatedAt || 0) < new Date(meta.qrSmsAttemptAt || 0);
    const preserveFinal = sameMessage && current.finalizedAt && !incoming.finalizedAt;
    const preserveNewer = sameMessage && new Date(incoming.updatedAt || 0) < new Date(current.updatedAt || 0);
    if (staleEvent || preserveFinal || preserveNewer) return rows[0];
    return tx.coupon.update({ where: { id: couponId }, data: { meta: {
      ...meta, ...patch, message: { ...(sameMessage ? current : {}), ...incoming },
    } } });
  }, options);
}

export function individualQrCouponData(parent, customer, phone, now = new Date()) {
  const meta = couponMeta(parent);
  const days = [15, 20, 30].includes(meta.claimValidityDays) ? meta.claimValidityDays : 30;
  return {
    partnerId: parent.partnerId,
    // This code is the private bearer link delivered to the phone, never returned by a public claim.
    code: `VOL-DF${Array.from({ length: 10 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join('')}`,
    sourceQrId: parent.id, claimPhone: phone, assignedToId: customer.id,
    kind: 'AMOUNT', variant: 'FIXED', amount: '0.00', campaign: 'DELIVERY_FREE',
    visibility: 'RESERVED', acquisition: 'CLAIM', channel: 'WEB', status: 'ACTIVE',
    usageLimit: 1, usageUnlimited: false, usedCount: 0, activeFrom: now,
    expiresAt: new Date(now.getTime() + days * 86400000),
    meta: { deliveryFree: true, claimedAt: now.toISOString(), termsVersion: QR_CLAIM_TERMS_VERSION,
      sourceQrCode: parent.code, campaignName: meta.campaignName,
      // Store ids are authoritative; sharing a postal code does not extend eligibility.
      targeting: { storeIds: meta.targeting?.storeIds || [], zipCodes: [] },
      targetStores: meta.targetStores || [], messageStatus: 'pending' },
  };
}

export async function claimDeliveryQr(prisma, { code, name, phone, termsVersion, now = new Date() }, send) {
  const normalizedPhone = normalizeClaimPhone(phone);
  if (!normalizedPhone) throw fail(400, 'invalid_phone');
  if (!String(name || '').trim() || String(name).length > 100) throw fail(400, 'name_required');
  if (termsVersion !== QR_CLAIM_TERMS_VERSION) throw fail(400, 'terms_required');

  const allocation = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRawUnsafe('SELECT * FROM Coupon WHERE code = ? FOR UPDATE', code);
    const parent = rows[0];
    if (!isDeliveryClaimQr(parent)) throw fail(404, 'coupon_not_found');
    let coupon = await tx.coupon.findUnique({ where: { sourceQrId_claimPhone: { sourceQrId: parent.id, claimPhone: normalizedPhone } } });
    const recovered = Boolean(coupon);
    // Stopping a QR stops new claims, not recovery of promises already made.
    if (!coupon) {
      if (!claimCampaignAvailable(parent, now)) throw fail(409, 'campaign_unavailable');
      const storeIds = couponMeta(parent).targeting?.storeIds || [];
      if (!storeIds.length || !await tx.store.count({ where: { id: { in: storeIds }, partnerId: parent.partnerId, active: true } }))
        throw fail(409, 'campaign_unavailable');
      // Serialize customer creation across this business's QR campaigns, not just this parent.
      await tx.$queryRawUnsafe('SELECT id FROM Partner WHERE id = ? FOR UPDATE', parent.partnerId);
      // Match complete normalized phone numbers, including legacy spacing and punctuation.
      const matches = await tx.$queryRawUnsafe(
        "SELECT id FROM Customer WHERE partnerId = ? AND REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '') IN (?, ?, ?) ORDER BY id ASC LIMIT 1",
        parent.partnerId, normalizedPhone.slice(-9), normalizedPhone.slice(1), `00${normalizedPhone.slice(1)}`,
      );
      let customer = matches[0];
      const customerCreated = !customer;
      if (!customer) customer = await tx.customer.create({ data: {
        partnerId: parent.partnerId, code: `CUS-${crypto.randomBytes(16).toString('hex').toUpperCase()}`,
        name: String(name).trim(), phone: normalizedPhone, address_1: '', origin: 'QR',
        marketingSuppressed: true,
      } });
      const data = individualQrCouponData(parent, customer, normalizedPhone, now);
      while (await tx.coupon.findUnique({ where: { code: data.code }, select: { id: true } })) {
        data.code = individualQrCouponData(parent, customer, normalizedPhone, now).code;
      }
      coupon = await tx.coupon.create({ data: { ...data, meta: {
        ...data.meta, qrCustomerCreated: customerCreated, qrCustomerId: customer.id,
      } } });
    }
    // Serialize send decisions with webhook/checkout changes as well.
    const locked = await tx.$queryRawUnsafe('SELECT * FROM Coupon WHERE id = ? FOR UPDATE', coupon.id);
    coupon = locked[0] || coupon;
    if (coupon.status === 'USED' || Number(coupon.usedCount) >= 1) throw fail(409, 'coupon_already_used');
    if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) throw fail(409, 'coupon_expired');
    if (coupon.status !== 'ACTIVE') throw fail(409, 'coupon_unavailable');
    const meta = couponMeta(coupon);
    const delivered = ['sent', 'queued', 'delivered'].includes(meta.messageStatus);
    // Durable, locked one-attempt guard: retries, concurrent requests and old clients
    // passing resend=true must never spend a second SMS for this phone/campaign.
    const shouldSend = !meta.qrSmsAttemptAt && !delivered && !meta.message?.providerMessageId;
    if (shouldSend) coupon = await tx.coupon.update({ where: { id: coupon.id }, data: {
      meta: { ...meta, qrSmsAttemptAt: now.toISOString(), messageStatus: 'pending' },
    } });
    return { coupon, recovered, shouldSend, delivered, status: meta.messageStatus || 'pending' };
  }, options);

  // `sent` describes provider acceptance, possibly from an earlier request.
  // Explicitly distinguish that history from a send performed by this request.
  let delivery = { sent: allocation.delivered, sentNow: false, status: allocation.status };
  if (allocation.shouldSend) {
    const result = await send(allocation.coupon, { id: allocation.coupon.assignedToId, phone: normalizedPhone });
    delivery = { sent: Boolean(result.ok), sentNow: Boolean(result.ok), status: result.status || 'failed' };
  }
  // Do not disclose a private coupon (or customer profile) to somebody merely typing a phone number.
  return { ok: true, recovered: allocation.recovered, expiresAt: allocation.coupon.expiresAt,
    delivery };
}
