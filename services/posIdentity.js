import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
export const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const normalizePosUsername = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
export const fail = (status, code) => Object.assign(new Error(code), { status, code });
const transactionOptions = { maxWait: 15000, timeout: 30000 };
export const canonicalRequest = ({ deviceId, timestamp, nonce, method, path, body = '', authorization = '' }) =>
  [deviceId, timestamp, nonce, method.toUpperCase(), path, digest(body), digest(authorization)].join('\n');

export function parseDeviceKey(encoded) {
  try {
    if (typeof encoded !== 'string' || encoded.length > 512) throw Error();
    const key = crypto.createPublicKey({ key: Buffer.from(encoded, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw Error();
    return key;
  } catch { throw fail(400, 'invalid_device_key'); }
}

export function verifyDeviceProof(req, key, expectedDevice, now = Date.now()) {
  const deviceId = req.get('x-volta-device') || '';
  const timestamp = req.get('x-volta-time') || '';
  const nonce = req.get('x-volta-nonce') || '';
  const signature = req.get('x-volta-signature') || '';
  if (deviceId !== expectedDevice || !/^\d{10}$/.test(timestamp) ||
      Math.abs(now - Number(timestamp) * 1000) > 120_000 ||
      !/^[a-zA-Z0-9_-]{20,64}$/.test(nonce) || signature.length > 256 || !signature) {
    throw fail(401, 'invalid_device_proof');
  }
  const canonical = canonicalRequest({ deviceId, timestamp, nonce, method: req.method,
    path: req.originalUrl, body: req.rawBody || '', authorization: req.get('authorization') || '' });
  try {
    if (!crypto.verify('sha256', Buffer.from(canonical), key, Buffer.from(signature, 'base64'))) throw Error();
  } catch { throw fail(401, 'invalid_device_proof'); }
  return nonce;
}

export async function verifyPin(pin, encoded) {
  const [algorithm, salt, hash] = String(encoded || '').split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  const computed = await scrypt(String(pin), salt, 64);
  return crypto.timingSafeEqual(computed, Buffer.from(hash, 'hex'));
}

export const safeDevice = (device) => ({ id: device.id, name: device.name, model: device.model,
  status: device.status, lastSeenAt: device.lastSeenAt });

export const audit = (tx, deviceId, action, actor, details = {}) => tx.posDeviceAudit.create({
  data: { id: crypto.randomUUID(), deviceId, action, actor, details },
});

export async function lockDevice(tx, deviceId) {
  await tx.$queryRawUnsafe('SELECT id FROM PosDevice WHERE id = ? FOR UPDATE', deviceId);
  const device = await tx.posDevice.findUnique({ where: { id: deviceId } });
  if (!device || device.status !== 'AUTHORIZED') throw fail(403, 'device_not_authorized');
  return device;
}

export async function authenticateDevice(prisma, req) {
  const id = req.get('x-volta-device');
  if (!/^[a-f0-9-]{36}$/.test(id || '')) throw fail(401, 'device_required');
  const device = await prisma.posDevice.findUnique({ where: { id } });
  if (!device) throw fail(401, 'device_required');
  const nonce = verifyDeviceProof(req, parseDeviceKey(device.publicKey), id);
  return prisma.$transaction(async tx => {
    const current = await lockDevice(tx, id);
    // All requests lock the same device before checking/creating the nonce.
    try {
      await tx.posDeviceNonce.create({ data: { deviceId: id, nonce, expiresAt: new Date(Date.now() + 300_000) } });
    } catch (error) { if (error.code === 'P2002') throw fail(401, 'request_replayed'); throw error; }
    // Housekeeping is occasional, not an extra database round trip on every request.
    if (crypto.randomInt(60) === 0) await tx.posDeviceNonce.deleteMany({ where: { deviceId: id, expiresAt: { lt: new Date() } } });
    await tx.posDevice.update({ where: { id }, data: { lastSeenAt: new Date() } });
    return current;
  }, transactionOptions);
}

export async function enrollDevice(prisma, req) {
  const { code, publicKey, model } = req.body || {};
  if (typeof code !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(code)) throw fail(401, 'invalid_enrollment');
  const key = parseDeviceKey(publicKey);
  verifyDeviceProof(req, key, 'enroll');
  // Canonicalize SPKI so alternate base64 encodings cannot duplicate an identity.
  const keyDer = key.export({ format: 'der', type: 'spki' });
  return prisma.$transaction(async tx => {
    const enrollment = await tx.posEnrollment.findUnique({ where: { tokenHash: digest(code) } });
    if (!enrollment) throw fail(401, 'invalid_enrollment');
    const consumed = await tx.posEnrollment.updateMany({ where: { id: enrollment.id,
      consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw fail(401, 'invalid_enrollment');
    const existing = await tx.posDevice.findUnique({ where: { publicKeyHash: digest(keyDer) } });
    if (existing) throw fail(409, 'device_already_registered');
    const device = await tx.posDevice.create({ data: { id: crypto.randomUUID(), name: enrollment.name,
      model: String(model || 'Unknown').slice(0, 80), publicKey: keyDer.toString('base64'),
      publicKeyHash: digest(keyDer), status: 'AUTHORIZED' } });
    await audit(tx, device.id, 'ENROLLED', enrollment.createdBy);
    return safeDevice(device);
  }, transactionOptions);
}

async function consumeLoginAttempt(prisma, deviceId, username) {
  const keys = [digest(`device:${deviceId}`), digest(`username:${username}`)].sort();
  return prisma.$transaction(async tx => {
    for (const key of keys) {
      await tx.posLoginThrottle.deleteMany({ where: { key, expiresAt: { lte: new Date() } } });
      const row = await tx.posLoginThrottle.upsert({ where: { key },
        create: { key, attempts: 1, expiresAt: new Date(Date.now() + 15 * 60_000) },
        update: { attempts: { increment: 1 } } });
      // Return instead of throwing so the attempt remains recorded.
      if (row.attempts > 20) return false;
    }
    return true;
  }, transactionOptions);
}

export async function loginStore(prisma, deviceId, body) {
  const username = normalizePosUsername(body?.username);
  const pin = String(body?.pin || '');
  if (!username || username.length > 120 || !/^\d{6}$/.test(pin)) {
    throw fail(401, 'invalid_credentials');
  }
  if (!(await consumeLoginAttempt(prisma, deviceId, username))) throw fail(429, 'login_rate_limited');
  const candidates = await prisma.$queryRawUnsafe(
    `SELECT s.id, s.partnerId, s.slug, s.posPinHash FROM Store s JOIN Partner p ON p.id=s.partnerId
     WHERE (LOWER(REPLACE(p.slug, ' ', ''))=? OR LOWER(REPLACE(p.name, ' ', ''))=?)
     AND p.active=true AND s.posCredentialsEnabled=true`, username, username);
  const matches = [];
  for (const store of candidates) {
    if (await verifyPin(pin, store.posPinHash)) matches.push(store);
  }
  if (!matches.length) throw fail(401, 'invalid_credentials');
  if (matches.length !== 1) throw fail(409, 'ambiguous_credentials');
  const match = matches[0];
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600_000);
  await prisma.$transaction(async tx => {
    await lockDevice(tx, deviceId);
    const store = await tx.store.findUnique({ where: { id: match.id }, include: { partner: true } });
    if (!store?.partner?.active || !store.posCredentialsEnabled || store.posPinHash !== match.posPinHash) {
      throw fail(401, 'invalid_credentials');
    }
    const existing = await tx.posSession.findUnique({ where: { deviceId } });
    if (existing) throw fail(409, 'logout_required');
    await tx.posSession.create({ data: { id: crypto.randomUUID(), deviceId, storeId: store.id,
      partnerId: store.partnerId, tokenHash: digest(token), credentialFingerprint: digest(store.posPinHash), expiresAt } });
    await audit(tx, deviceId, 'STORE_LOGIN', 'store_credentials', { storeId: store.id, partnerId: store.partnerId });
  }, transactionOptions);
  return { token, expiresAt };
}

export async function requireStoreSession(prisma, deviceId, authorization) {
  const token = /^Bearer ([a-zA-Z0-9_-]{43})$/.exec(authorization || '')?.[1];
  if (!token) throw fail(401, 'session_required');
  const session = await prisma.posSession.findUnique({ where: { deviceId }, include: {
    device: true, store: { include: { partner: true } },
  } });
  if (!session || session.tokenHash !== digest(token) || session.expiresAt <= new Date() ||
      session.device.status !== 'AUTHORIZED' || !session.store.partner.active ||
      !session.store.posCredentialsEnabled || session.partnerId !== session.store.partnerId ||
      session.credentialFingerprint !== digest(session.store.posPinHash || '')) {
    throw fail(401, 'session_expired');
  }
  return session;
}

export async function logoutStore(prisma, deviceId) {
  await prisma.$transaction(async tx => {
    await lockDevice(tx, deviceId);
    await tx.posSession.deleteMany({ where: { deviceId } });
    await audit(tx, deviceId, 'STORE_LOGOUT', 'device');
  }, transactionOptions);
}

export async function setDeviceStatus(prisma, id, status, actor, reason) {
  if (!['AUTHORIZED', 'SUSPENDED', 'REVOKED'].includes(status) || !actor || !reason) throw fail(400, 'invalid_admin_change');
  return prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT id FROM PosDevice WHERE id = ? FOR UPDATE', id);
    const previous = await tx.posDevice.findUnique({ where: { id } });
    if (!previous) throw fail(404, 'device_not_found');
    if (previous.status === 'REVOKED' && status !== 'REVOKED') throw fail(409, 'revocation_is_permanent');
    const updated = await tx.posDevice.update({ where: { id }, data: { status } });
    await tx.posSession.deleteMany({ where: { deviceId: id } });
    await audit(tx, id, status, actor, { reason, previousStatus: previous.status });
    return safeDevice(updated);
  }, transactionOptions);
}
