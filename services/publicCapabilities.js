import crypto from 'node:crypto';

const signingKey = () => {
  const key = process.env.WEB_ACTION_SIGNING_KEY || process.env.DATABASE_URL;
  if (!key) throw new Error('public_action_signing_not_configured');
  return crypto.createHash('sha256').update(key).digest();
};
export function signPublicAction(purpose, id, expiresAt) {
  if (!['repeat', 'cancel'].includes(purpose) || !Number.isSafeInteger(id) || id < 1 || !Number.isFinite(expiresAt)) throw new Error('invalid_public_action');
  const payload = `${purpose}:${id}:${Math.floor(expiresAt / 1000)}`;
  const signature = crypto.createHmac('sha256', signingKey()).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${signature}`;
}
export function verifyPublicAction(token, purpose, now = Date.now()) {
  const parts = /^([A-Za-z0-9_-]{1,160})\.([a-f0-9]{64})$/.exec(String(token || ''));
  if (!parts) return null;
  const payload = Buffer.from(parts[1], 'base64url').toString();
  const [kind, id, expiry] = payload.split(':');
  if (kind !== purpose || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !/^\d+$/.test(expiry) || Number(expiry) * 1000 <= now) return null;
  const expected = crypto.createHmac('sha256', signingKey()).update(payload).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(parts[2], 'hex'))) return null;
  return Number(id);
}
